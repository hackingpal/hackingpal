import 'package:flutter/material.dart';
import 'api.dart';
import 'chat.dart';
import 'screens.dart';
import 'settings.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final url = await Settings.load();
  runApp(MyApp(initialUrl: url));
}

class MyApp extends StatefulWidget {
  final String initialUrl;
  const MyApp({super.key, required this.initialUrl});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  late ApiClient _client;

  @override
  void initState() {
    super.initState();
    _client = ApiClient(widget.initialUrl);
  }

  @override
  Widget build(BuildContext c) {
    return MaterialApp(
      title: 'MyHackingPal',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF6750A4),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: Shell(
        client: _client,
        onUrlChanged: (u) => setState(() => _client = ApiClient(u)),
      ),
    );
  }
}

class Shell extends StatefulWidget {
  final ApiClient client;
  final void Function(String) onUrlChanged;
  const Shell({super.key, required this.client, required this.onUrlChanged});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _idx = 0;

  List<_Page> get _pages => [
        _Page(
          'IP Checker',
          Icons.travel_explore,
          ToolScreen(
            title: 'IP Checker',
            hint: 'IP address or hostname',
            defaultInput: '8.8.8.8',
            client: widget.client,
            action: (c, a, _) => c.ipLookup(a),
          ),
        ),
        _Page(
          'DNS Recon',
          Icons.dns,
          ToolScreen(
            title: 'DNS Recon',
            hint: 'Domain (e.g. example.com)',
            defaultInput: 'example.com',
            client: widget.client,
            action: (c, a, _) => c.dnsRecon(a),
          ),
        ),
        _Page(
          'WHOIS · ASN',
          Icons.badge,
          ToolScreen(
            title: 'WHOIS',
            hint: 'Domain or IP',
            defaultInput: 'example.com',
            client: widget.client,
            action: (c, a, _) => c.whoisLookup(a),
          ),
        ),
        _Page(
          'TLS Audit',
          Icons.lock_outline,
          ToolScreen(
            title: 'TLS Audit',
            hint: 'Host (defaults to port 443)',
            defaultInput: 'example.com',
            client: widget.client,
            action: (c, a, _) => c.tlsAudit(a),
          ),
        ),
        _Page(
          'Fingerprint',
          Icons.fingerprint,
          ToolScreen(
            title: 'Fingerprint',
            hint: 'Host',
            hint2: 'Port',
            defaultInput: 'example.com',
            defaultInput2: '443',
            client: widget.client,
            action: (c, a, b) => c.fingerprint(a, int.tryParse(b ?? '') ?? 443),
          ),
        ),
        _Page(
          'CT Logs',
          Icons.receipt_long,
          ToolScreen(
            title: 'CT Logs',
            hint: 'Domain — finds subdomains via cert transparency',
            defaultInput: 'example.com',
            client: widget.client,
            action: (c, a, _) => c.ctSearch(a),
          ),
        ),
        _Page(
          'Email Security',
          Icons.alternate_email,
          ToolScreen(
            title: 'Email Security',
            hint: 'Domain — SPF / DMARC / DKIM / BIMI / MTA-STS',
            defaultInput: 'example.com',
            client: widget.client,
            action: (c, a, _) => c.emailAudit(a),
          ),
        ),
        _Page('Chat', Icons.smart_toy, ChatScreen(client: widget.client)),
        _Page(
          'Settings',
          Icons.settings,
          SettingsScreen(
            client: widget.client,
            onUrlChanged: widget.onUrlChanged,
          ),
        ),
      ];

  @override
  Widget build(BuildContext c) {
    final pages = _pages;
    final p = pages[_idx];
    return Scaffold(
      appBar: AppBar(
        title: Text(p.title),
        actions: [
          IconButton(
            tooltip: 'Backend: ${widget.client.baseUrl}',
            icon: const Icon(Icons.cloud_outlined),
            onPressed: () => setState(() => _idx = pages.length - 1),
          ),
        ],
      ),
      drawer: Drawer(
        child: SafeArea(
          child: ListView(
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text(
                  'MyHackingPal',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Text(
                  widget.client.baseUrl,
                  style: const TextStyle(fontSize: 11, color: Colors.grey),
                ),
              ),
              const Divider(),
              for (var i = 0; i < pages.length; i++)
                ListTile(
                  leading: Icon(pages[i].icon),
                  title: Text(pages[i].title),
                  selected: i == _idx,
                  onTap: () {
                    setState(() => _idx = i);
                    Navigator.pop(context);
                  },
                ),
            ],
          ),
        ),
      ),
      body: p.widget,
    );
  }
}

class _Page {
  final String title;
  final IconData icon;
  final Widget widget;
  _Page(this.title, this.icon, this.widget);
}
