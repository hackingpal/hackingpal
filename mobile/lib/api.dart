import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiException implements Exception {
  final int status;
  final String body;
  ApiException(this.status, this.body);
  @override
  String toString() => 'HTTP $status: $body';
}

class ApiClient {
  String baseUrl;
  ApiClient(this.baseUrl);

  Uri _u(String path, [Map<String, String>? q]) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: q);

  Future<dynamic> _get(String path,
      {Map<String, String>? query,
      Duration timeout = const Duration(seconds: 30)}) async {
    final r = await http.get(_u(path, query)).timeout(timeout);
    if (r.statusCode == 200) return jsonDecode(r.body);
    throw ApiException(r.statusCode, r.body);
  }

  Future<dynamic> ipLookup(String addr) => _get('/ip/$addr');
  Future<dynamic> dnsRecon(String domain) =>
      _get('/dns/recon/$domain', query: {'confirm': 'true'},
          timeout: const Duration(seconds: 60));
  Future<dynamic> whoisLookup(String target) => _get('/whois/$target');
  Future<dynamic> tlsAudit(String host) =>
      _get('/tls/audit/$host', timeout: const Duration(seconds: 60));
  Future<dynamic> fingerprint(String host, int port) =>
      _get('/fingerprint/$host/$port',
          timeout: const Duration(seconds: 30));
  Future<dynamic> ctSearch(String domain) =>
      _get('/ct/search/$domain', query: {'confirm': 'true'},
          timeout: const Duration(seconds: 60));
  Future<dynamic> emailAudit(String domain) =>
      _get('/email/audit/$domain', query: {'confirm': 'true'},
          timeout: const Duration(seconds: 60));
  Future<dynamic> chatConfig() => _get('/chat/config');
  Future<dynamic> health() =>
      _get('/health', timeout: const Duration(seconds: 5));

  Stream<Map<String, dynamic>> chatStream(
      List<Map<String, String>> messages) async* {
    final req = http.Request('POST', _u('/chat/stream'));
    req.headers['Content-Type'] = 'application/json';
    req.body = jsonEncode({
      'messages': messages,
      'session_log': [],
      'active_page': 'mobile',
    });
    final resp = await req.send();
    if (resp.statusCode != 200) {
      final body = await resp.stream.bytesToString();
      throw ApiException(resp.statusCode, body);
    }
    final lines =
        resp.stream.transform(utf8.decoder).transform(const LineSplitter());
    await for (final line in lines) {
      if (!line.startsWith('data: ')) continue;
      final payload = line.substring(6);
      if (payload.isEmpty) continue;
      try {
        yield jsonDecode(payload) as Map<String, dynamic>;
      } catch (_) {
        // skip malformed SSE lines
      }
    }
  }
}
