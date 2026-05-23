import 'package:flutter/material.dart';
import 'api.dart';

class ChatMessage {
  final String role; // "user" | "assistant"
  String content;
  ChatMessage(this.role, this.content);
  Map<String, String> toJson() => {'role': role, 'content': content};
}

class ChatScreen extends StatefulWidget {
  final ApiClient client;
  const ChatScreen({super.key, required this.client});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _messages = <ChatMessage>[];
  bool _streaming = false;
  bool _thinking = false;

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _streaming) return;
    _input.clear();
    setState(() {
      _messages.add(ChatMessage('user', text));
      _messages.add(ChatMessage('assistant', ''));
      _streaming = true;
      _thinking = false;
    });
    _scrollToEnd();
    final reply = _messages.last;
    try {
      // Don't send the empty placeholder we just appended.
      final outbound =
          _messages.sublist(0, _messages.length - 1).map((m) => m.toJson()).toList();
      await for (final ev in widget.client.chatStream(outbound)) {
        switch (ev['type']) {
          case 'thinking_start':
            setState(() => _thinking = true);
            break;
          case 'text_start':
            setState(() => _thinking = false);
            break;
          case 'text_delta':
            setState(() => reply.content += (ev['text'] as String? ?? ''));
            _scrollToEnd();
            break;
          case 'error':
            setState(() =>
                reply.content += '\n\n⚠ ${ev['message'] ?? 'unknown error'}');
            break;
        }
      }
    } catch (e) {
      setState(() => reply.content = '⚠ $e');
    } finally {
      setState(() {
        _streaming = false;
        _thinking = false;
      });
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext c) {
    return Column(
      children: [
        Expanded(
          child: _messages.isEmpty
              ? const Center(
                  child: Text(
                    'Ask Claude about a scan result, a CVE,\nor a security concept.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey),
                  ),
                )
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.all(12),
                  itemCount: _messages.length,
                  itemBuilder: (c, i) => _bubble(_messages[i]),
                ),
        ),
        if (_thinking)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(strokeWidth: 2)),
                SizedBox(width: 8),
                Text('Thinking…', style: TextStyle(color: Colors.grey)),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  enabled: !_streaming,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    hintText: 'Ask…',
                  ),
                  minLines: 1,
                  maxLines: 4,
                  onSubmitted: (_) => _send(),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                onPressed: _streaming ? null : _send,
                icon: const Icon(Icons.send),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _bubble(ChatMessage m) {
    final isUser = m.role == 'user';
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: const BoxConstraints(maxWidth: 320),
        decoration: BoxDecoration(
          color: isUser
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: SelectableText(
          m.content.isEmpty ? '…' : m.content,
          style: const TextStyle(fontSize: 14),
        ),
      ),
    );
  }
}
