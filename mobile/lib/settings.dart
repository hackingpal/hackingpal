import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

class Settings {
  static const _key = 'backend_url';
  static const defaultUrl = 'http://100.75.23.96:8765';

  static Future<String> load() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_key) ?? defaultUrl;
  }

  static Future<void> save(String url) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_key, url);
  }
}

class SettingsScreen extends StatefulWidget {
  final ApiClient client;
  final void Function(String) onUrlChanged;
  const SettingsScreen(
      {super.key, required this.client, required this.onUrlChanged});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _urlController;
  String? _status;
  bool _testing = false;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: widget.client.baseUrl);
  }

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _status = 'Testing…';
    });
    try {
      final h = await ApiClient(_urlController.text.trim()).health();
      setState(() => _status =
          'OK — backend ${h["version"]}, pid ${h["pid"]}');
    } catch (e) {
      setState(() => _status = 'FAIL: $e');
    } finally {
      setState(() => _testing = false);
    }
  }

  Future<void> _save() async {
    final url = _urlController.text.trim();
    await Settings.save(url);
    widget.onUrlChanged(url);
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Saved $url')));
    }
  }

  @override
  Widget build(BuildContext c) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Backend URL',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          TextField(
            controller: _urlController,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'http://100.75.23.96:8765',
            ),
            autocorrect: false,
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 16),
          Row(children: [
            FilledButton(
                onPressed: _testing ? null : _test,
                child: const Text('Test')),
            const SizedBox(width: 8),
            FilledButton.tonal(onPressed: _save, child: const Text('Save')),
          ]),
          if (_status != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: SelectableText(_status!),
            ),
          const SizedBox(height: 24),
          const Text(
            'Default points at the Mac\'s Tailscale IP. Backend must be running '
            '(docker compose up -d in ~/network_tools) and the device must be on '
            'the same tailnet.',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }
}
