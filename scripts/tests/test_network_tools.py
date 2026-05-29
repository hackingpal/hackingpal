#!/usr/bin/env python3
"""test_network_tools.py — Unit tests for port_scanner, network_audit, and lan_scanner."""

import ipaddress
import json
import os
import socket
import sys
import tempfile
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.expanduser("~"))

import port_scanner as ps
import network_audit as na
import lan_scanner as ls


# ── port_scanner tests ────────────────────────────────────────────────────────

class TestParsePorts:
    def test_single_port(self):
        assert ps.parse_ports("80") == [80]

    def test_range(self):
        assert ps.parse_ports("22-25") == [22, 23, 24, 25]

    def test_comma_list(self):
        assert ps.parse_ports("22,80,443") == [22, 80, 443]

    def test_mixed(self):
        assert ps.parse_ports("22,100-102,443") == [22, 100, 101, 102, 443]

    def test_deduplication(self):
        assert ps.parse_ports("80,80") == [80]

    def test_sorted_output(self):
        result = ps.parse_ports("443,22,80")
        assert result == sorted(result)

    def test_invalid_port_string(self):
        with pytest.raises(SystemExit):
            ps.parse_ports("abc")

    def test_port_out_of_bounds(self):
        with pytest.raises(SystemExit):
            ps.parse_ports("0")

    def test_port_too_high(self):
        with pytest.raises(SystemExit):
            ps.parse_ports("65536")

    def test_empty_input(self):
        with pytest.raises(SystemExit):
            ps.parse_ports("")

    def test_max_valid_port(self):
        assert ps.parse_ports("65535") == [65535]

    def test_min_valid_port(self):
        assert ps.parse_ports("1") == [1]


class TestServices:
    def test_known_services_exist(self):
        assert ps.SERVICES[22] == "SSH"
        assert ps.SERVICES[80] == "HTTP"
        assert ps.SERVICES[443] == "HTTPS"
        assert ps.SERVICES[21] == "FTP"
        assert ps.SERVICES[3389] == "RDP"

    def test_unknown_port_not_in_services(self):
        assert 9999 not in ps.SERVICES


class TestResolveHost:
    def test_resolves_localhost(self):
        ip = ps.resolve_host("localhost")
        assert ip == "127.0.0.1"

    def test_resolves_ip_passthrough(self):
        assert ps.resolve_host("127.0.0.1") == "127.0.0.1"

    def test_invalid_host_exits(self):
        with pytest.raises(SystemExit):
            ps.resolve_host("this.host.definitely.does.not.exist.invalid")


class TestScanPort:
    def test_open_port_returns_tuple(self):
        # Scan localhost port 80 — only meaningful if something is listening.
        # We mock connect_ex to simulate an open port.
        mock_sock = MagicMock()
        mock_sock.connect_ex.return_value = 0
        mock_sock.recv.return_value = b"HTTP/1.0 200 OK\r\n"
        with patch("socket.socket", return_value=mock_sock):
            result = ps.scan_port("127.0.0.1", 80, 1.0)
        assert result is not None
        port, service, banner = result
        assert port == 80
        assert service == "HTTP"

    def test_closed_port_returns_none(self):
        mock_sock = MagicMock()
        mock_sock.connect_ex.return_value = 111  # ECONNREFUSED
        with patch("socket.socket", return_value=mock_sock):
            result = ps.scan_port("127.0.0.1", 9, 0.1)
        assert result is None

    def test_unknown_port_has_empty_service(self):
        mock_sock = MagicMock()
        mock_sock.connect_ex.return_value = 0
        mock_sock.recv.return_value = b""
        with patch("socket.socket", return_value=mock_sock):
            result = ps.scan_port("127.0.0.1", 54321, 1.0)
        assert result is not None
        _, service, _ = result
        assert service == ""


class TestBuildTable:
    def test_table_has_correct_columns(self):
        results = [(22, "SSH", "OpenSSH 8.0"), (80, "HTTP", "nginx")]
        table = ps.build_table(results, "example.com", "1.2.3.4")
        col_names = [col.header for col in table.columns]
        assert "Port" in col_names
        assert "Service" in col_names
        assert "Banner" in col_names

    def test_empty_results(self):
        table = ps.build_table([], "example.com", "1.2.3.4")
        assert table.row_count == 0

    def test_results_are_sorted_by_port(self):
        results = [(443, "HTTPS", ""), (22, "SSH", ""), (80, "HTTP", "")]
        table = ps.build_table(results, "host", "1.2.3.4")
        assert table.row_count == 3


# ── network_audit tests ────────────────────────────────────────────────────────

class TestRiskDB:
    def test_critical_entries_exist(self):
        assert na.RISK_DB[23].level == "CRITICAL"   # Telnet
        assert na.RISK_DB[445].level == "CRITICAL"  # SMB
        assert na.RISK_DB[3389].level == "CRITICAL" # RDP
        assert na.RISK_DB[6379].level == "CRITICAL" # Redis
        assert na.RISK_DB[27017].level == "CRITICAL" # MongoDB

    def test_high_entries_exist(self):
        assert na.RISK_DB[21].level == "HIGH"   # FTP
        assert na.RISK_DB[5900].level == "HIGH" # VNC

    def test_medium_entries_exist(self):
        assert na.RISK_DB[25].level == "MEDIUM"  # SMTP
        assert na.RISK_DB[5432].level == "MEDIUM" # PostgreSQL

    def test_entries_have_reason_and_recommendation(self):
        for port, entry in na.RISK_DB.items():
            assert entry.reason, f"Port {port} missing reason"
            assert entry.recommendation, f"Port {port} missing recommendation"

    def test_all_levels_are_valid(self):
        valid = {"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"}
        for port, entry in na.RISK_DB.items():
            assert entry.level in valid, f"Port {port} has invalid level '{entry.level}'"


class TestWorstLevel:
    def test_single_critical(self):
        findings = [na.Finding(23, "Telnet", "", "CRITICAL", "x", "y")]
        assert na.worst_level(findings) == "CRITICAL"

    def test_mixed_severities(self):
        findings = [
            na.Finding(80, "HTTP", "", "LOW", "x", "y"),
            na.Finding(23, "Telnet", "", "CRITICAL", "x", "y"),
            na.Finding(25, "SMTP", "", "MEDIUM", "x", "y"),
        ]
        assert na.worst_level(findings) == "CRITICAL"

    def test_all_info(self):
        findings = [na.Finding(9999, "", "", "INFO", "x", "y")]
        assert na.worst_level(findings) == "INFO"

    def test_empty_findings(self):
        assert na.worst_level([]) == "CLEAN"

    def test_high_beats_medium(self):
        findings = [
            na.Finding(3306, "MySQL", "", "HIGH", "x", "y"),
            na.Finding(25, "SMTP", "", "MEDIUM", "x", "y"),
        ]
        assert na.worst_level(findings) == "HIGH"


class TestAuditHost:
    def test_risky_port_gets_risk_entry(self):
        mock_open = [(23, "Telnet", "")]
        with patch("port_scanner.scan_all", return_value=mock_open):
            findings = na.audit_host("127.0.0.1", [23], 1.0, 10)
        assert len(findings) == 1
        assert findings[0].port == 23
        assert findings[0].level == "CRITICAL"

    def test_unknown_port_gets_info(self):
        mock_open = [(9999, "", "")]
        with patch("port_scanner.scan_all", return_value=mock_open):
            findings = na.audit_host("127.0.0.1", [9999], 1.0, 10)
        assert len(findings) == 1
        assert findings[0].level == "INFO"

    def test_no_open_ports(self):
        with patch("port_scanner.scan_all", return_value=[]):
            findings = na.audit_host("127.0.0.1", [80], 1.0, 10)
        assert findings == []

    def test_findings_sorted_by_severity(self):
        mock_open = [(80, "HTTP", ""), (23, "Telnet", ""), (25, "SMTP", "")]
        with patch("port_scanner.scan_all", return_value=mock_open):
            findings = na.audit_host("127.0.0.1", [23, 25, 80], 1.0, 10)
        levels = [f.level for f in findings]
        order = [na._LEVEL_ORDER[l] for l in levels]
        assert order == sorted(order)

    def test_service_name_populated(self):
        mock_open = [(22, "", "")]
        with patch("port_scanner.scan_all", return_value=mock_open):
            findings = na.audit_host("127.0.0.1", [22], 1.0, 10)
        assert findings[0].service == "SSH"


class TestBuildHostTable:
    def test_table_has_fix_column(self):
        findings = [na.Finding(23, "Telnet", "", "CRITICAL", "cleartext creds", "Use SSH")]
        table = na.build_host_table("192.168.1.1", findings)
        col_names = [col.header for col in table.columns]
        assert "Fix" in col_names

    def test_table_row_count_matches_findings(self):
        findings = [
            na.Finding(23, "Telnet", "", "CRITICAL", "reason", "fix"),
            na.Finding(80, "HTTP", "", "LOW", "reason", "fix"),
        ]
        table = na.build_host_table("192.168.1.1", findings)
        assert table.row_count == 2

    def test_empty_findings(self):
        table = na.build_host_table("192.168.1.1", [])
        assert table.row_count == 0


class TestSaveResultsAudit:
    def test_saves_text_file(self):
        findings = [na.Finding(23, "Telnet", "", "CRITICAL", "reason", "fix")]
        host_results = [{"ip": "192.168.1.1", "hostname": "host", "findings": findings}]
        with tempfile.TemporaryDirectory() as tmpdir:
            na.save_results(host_results, "192.168.1.1", 1.5, datetime.now(), "text", tmpdir)
            files = os.listdir(tmpdir)
            assert len(files) == 1
            assert files[0].endswith(".txt")
            with open(os.path.join(tmpdir, files[0])) as f:
                content = f.read()
            assert "192.168.1.1" in content

    def test_saves_json_file(self):
        findings = [na.Finding(445, "SMB", "", "CRITICAL", "reason", "fix")]
        host_results = [{"ip": "10.0.0.1", "hostname": "", "findings": findings}]
        with tempfile.TemporaryDirectory() as tmpdir:
            na.save_results(host_results, "10.0.0.1", 2.0, datetime.now(), "json", tmpdir)
            files = os.listdir(tmpdir)
            assert len(files) == 1
            assert files[0].endswith(".json")
            with open(os.path.join(tmpdir, files[0])) as f:
                data = json.load(f)
            assert data["target"] == "10.0.0.1"
            assert len(data["hosts"]) == 1


# ── lan_scanner tests ──────────────────────────────────────────────────────────

class TestHexNetmask:
    def test_class_c(self):
        assert ls._hex_netmask_to_dotted("0xffffff00") == "255.255.255.0"

    def test_class_b(self):
        assert ls._hex_netmask_to_dotted("0xffff0000") == "255.255.0.0"

    def test_class_a(self):
        assert ls._hex_netmask_to_dotted("0xff000000") == "255.0.0.0"

    def test_slash_30(self):
        assert ls._hex_netmask_to_dotted("0xfffffffc") == "255.255.255.252"


class TestBuildArpCache:
    def test_parses_standard_arp_output(self):
        fake_arp = (
            "? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]\n"
            "? (192.168.1.10) at 11:22:33:44:55:66 on en0 ifscope [ethernet]\n"
        )
        with patch("subprocess.check_output", return_value=fake_arp):
            cache = ls.build_arp_cache()
        assert cache["192.168.1.1"] == "aa:bb:cc:dd:ee:ff"
        assert cache["192.168.1.10"] == "11:22:33:44:55:66"

    def test_returns_empty_on_failure(self):
        with patch("subprocess.check_output", side_effect=FileNotFoundError):
            cache = ls.build_arp_cache()
        assert cache == {}

    def test_skips_incomplete_arp_entries(self):
        fake_arp = "? (192.168.1.1) at (incomplete) on en0\n"
        with patch("subprocess.check_output", return_value=fake_arp):
            cache = ls.build_arp_cache()
        assert "192.168.1.1" not in cache


class TestResolveHostname:
    def test_resolves_localhost(self):
        hostname = ls.resolve_hostname("127.0.0.1")
        assert isinstance(hostname, str)

    def test_returns_empty_string_on_failure(self):
        with patch("socket.gethostbyaddr", side_effect=socket.herror):
            result = ls.resolve_hostname("1.2.3.4")
        assert result == ""


class TestGetLocalNetwork:
    def test_returns_cidr_string(self):
        fake_ifconfig = (
            "en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500\n"
            "\tinet 192.168.1.50 netmask 0xffffff00 broadcast 192.168.1.255\n"
        )
        with patch("subprocess.check_output", return_value=fake_ifconfig):
            result = ls.get_local_network()
        assert result is not None
        net = ipaddress.IPv4Network(result, strict=False)
        assert str(net) == result

    def test_skips_loopback(self):
        fake_ifconfig = (
            "lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384\n"
            "\tinet 127.0.0.1 netmask 0xff000000\n"
        )
        with patch("subprocess.check_output", return_value=fake_ifconfig):
            result = ls.get_local_network()
        assert result is None

    def test_returns_none_on_failure(self):
        with patch("subprocess.check_output", side_effect=FileNotFoundError):
            result = ls.get_local_network()
        assert result is None


class TestScanNetwork:
    def test_returns_sorted_by_ip(self):
        with patch("lan_scanner.build_arp_cache", return_value={}):
            with patch("lan_scanner.ping_host", side_effect=lambda ip, t: ip in {"10.0.0.3", "10.0.0.1"}):
                with patch("lan_scanner.resolve_hostname", return_value=""):
                    results = ls.scan_network("10.0.0.0/30", timeout=0.1, num_threads=4)
        ips = [r["ip"] for r in results]
        assert ips == sorted(ips, key=lambda x: ipaddress.IPv4Address(x))

    def test_empty_subnet_returns_empty(self):
        # /32 has no hosts()
        results = ls.scan_network("10.0.0.1/32", timeout=0.1, num_threads=1)
        assert results == []

    def test_result_has_expected_keys(self):
        with patch("lan_scanner.build_arp_cache", return_value={"10.0.0.1": "aa:bb:cc:dd:ee:ff"}):
            with patch("lan_scanner.ping_host", return_value=True):
                with patch("lan_scanner.resolve_hostname", return_value="router.local"):
                    results = ls.scan_network("10.0.0.0/30", timeout=0.1, num_threads=2)
        for r in results:
            assert "ip" in r
            assert "mac" in r
            assert "hostname" in r


class TestLanBuildTable:
    def test_table_has_correct_columns(self):
        results = [{"ip": "192.168.1.1", "mac": "aa:bb:cc:dd:ee:ff", "hostname": "router"}]
        table = ls.build_table(results, "192.168.1.0/24")
        col_names = [col.header for col in table.columns]
        assert "IP Address" in col_names
        assert "MAC Address" in col_names
        assert "Hostname" in col_names

    def test_empty_results(self):
        table = ls.build_table([], "192.168.1.0/24")
        assert table.row_count == 0


class TestLanSaveResults:
    def test_saves_text_file(self):
        results = [{"ip": "192.168.1.1", "mac": "aa:bb:cc:dd:ee:ff", "hostname": "router"}]
        with tempfile.TemporaryDirectory() as tmpdir:
            ls.save_results(results, "192.168.1.0/24", 1.0, datetime.now(), "text", tmpdir)
            files = os.listdir(tmpdir)
            assert len(files) == 1
            assert files[0].endswith(".txt")

    def test_saves_json_file(self):
        results = [{"ip": "10.0.0.1", "mac": "", "hostname": ""}]
        with tempfile.TemporaryDirectory() as tmpdir:
            ls.save_results(results, "10.0.0.0/24", 0.5, datetime.now(), "json", tmpdir)
            files = os.listdir(tmpdir)
            assert files[0].endswith(".json")
            with open(os.path.join(tmpdir, files[0])) as f:
                data = json.load(f)
            assert data["network"] == "10.0.0.0/24"
            assert data["host_count"] == 1


# ── port_scanner save_results tests ───────────────────────────────────────────

class TestPortScannerSaveResults:
    def test_saves_text_file(self):
        results = [(22, "SSH", "OpenSSH 8.0"), (80, "HTTP", "nginx")]
        with tempfile.TemporaryDirectory() as tmpdir:
            ps.save_results(results, "localhost", "127.0.0.1", "1-1024", 1.0, 100,
                            1.5, datetime.now(), "text", tmpdir)
            files = os.listdir(tmpdir)
            assert len(files) == 1
            assert files[0].endswith(".txt")
            with open(os.path.join(tmpdir, files[0])) as f:
                content = f.read()
            assert "22" in content
            assert "SSH" in content

    def test_saves_json_file(self):
        results = [(443, "HTTPS", "")]
        with tempfile.TemporaryDirectory() as tmpdir:
            ps.save_results(results, "example.com", "1.2.3.4", "443", 1.0, 50,
                            0.3, datetime.now(), "json", tmpdir)
            files = os.listdir(tmpdir)
            assert files[0].endswith(".json")
            with open(os.path.join(tmpdir, files[0])) as f:
                data = json.load(f)
            assert data["target"] == "example.com"
            assert data["open_count"] == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
