import 'dart:convert';
import 'package:flutter/material.dart';
import 'api.dart';

/// Generic single-input tool screen. The action callback runs against the
/// passed-in ApiClient and returns parsed JSON which gets rendered as
/// pretty-printed text in a scrollable box.
class ToolScreen extends StatefulWidget {
  final String title;
  final String hint;
  final String? hint2;
  final String defaultInput;
  final String? defaultInput2;
  final Future<dynamic> Function(ApiClient c, String a, String? b) action;
  final ApiClient client;

  const ToolScreen({
    super.key,
    required this.title,
    required this.hint,
    required this.action,
    required this.client,
    this.hint2,
    this.defaultInput = '',
    this.defaultInput2,
  });

  @override
  State<ToolScreen> createState() => _ToolScreenState();
}

class _ToolScreenState extends State<ToolScreen> {
  late final TextEditingController _ctrl;
  late final TextEditingController _ctrl2;
  String? _result;
  bool _loading = false;
  Duration? _elapsed;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: widget.defaultInput);
    _ctrl2 = TextEditingController(text: widget.defaultInput2 ?? '');
  }

  Future<void> _run() async {
    final t0 = DateTime.now();
    setState(() {
      _loading = true;
      _result = null;
      _elapsed = null;
    });
    try {
      final r = await widget.action(
        widget.client,
        _ctrl.text.trim(),
        widget.hint2 == null ? null : _ctrl2.text.trim(),
      );
      setState(() => _result = const JsonEncoder.withIndent('  ').convert(r));
    } catch (e) {
      setState(() => _result = '⚠ $e');
    } finally {
      setState(() {
        _loading = false;
        _elapsed = DateTime.now().difference(t0);
      });
    }
  }

  @override
  Widget build(BuildContext c) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _ctrl,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              labelText: widget.hint,
            ),
            autocorrect: false,
            onSubmitted: (_) => _loading ? null : _run(),
          ),
          if (widget.hint2 != null) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _ctrl2,
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                labelText: widget.hint2,
              ),
              keyboardType: TextInputType.number,
              onSubmitted: (_) => _loading ? null : _run(),
            ),
          ],
          const SizedBox(height: 12),
          Row(children: [
            FilledButton.icon(
              onPressed: _loading ? null : _run,
              icon: _loading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.play_arrow),
              label: Text(_loading ? 'Running…' : 'Run'),
            ),
            if (_elapsed != null && !_loading) ...[
              const SizedBox(width: 12),
              Text('${_elapsed!.inMilliseconds} ms',
                  style: const TextStyle(color: Colors.grey)),
            ],
          ]),
          const SizedBox(height: 16),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(c).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: _result == null
                  ? Center(
                      child: Text(
                        _loading ? 'Querying…' : 'Results will appear here',
                        style: const TextStyle(color: Colors.grey),
                      ),
                    )
                  : SingleChildScrollView(
                      child: SelectableText(
                        _result!,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 12,
                        ),
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
