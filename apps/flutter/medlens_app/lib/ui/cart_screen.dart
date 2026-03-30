import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../state/cart_state.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartState>();
    final items = cart.items;

    final grouped = <String, List<CartLine>>{};
    for (final line in items) {
      final key = line.source == CartSource.local
          ? 'local:${line.pharmacyId}'
          : 'online:${line.onlineProviderId}';
      grouped.putIfAbsent(key, () => []).add(line);
    }

    Future<void> openUrls(List<String> urls) async {
      for (var i = 0; i < urls.length; i++) {
        final u = Uri.parse(urls[i]);
        // stagger like the web UI (reduces popup blocking in browsers; on mobile it avoids jank)
        unawaited(launchUrl(u, mode: LaunchMode.externalApplication));
        await Future<void>.delayed(const Duration(milliseconds: 450));
      }
    }

    List<String> uniqueUrls(Iterable<CartLine> lines) {
      final seen = <String>{};
      final out = <String>[];
      for (final l in lines) {
        final u = l.checkoutUrl;
        if (u.isEmpty) continue;
        if (seen.add(u)) out.add(u);
      }
      return out;
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cart'),
        actions: [
          if (items.isNotEmpty)
            TextButton(
              onPressed: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Clear cart?'),
                    content: const Text('Remove all items from the cart?'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                      FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Clear')),
                    ],
                  ),
                );
                if (ok == true) await cart.clear();
              },
              child: const Text('Clear'),
            ),
        ],
      ),
      body: items.isEmpty
          ? const Center(child: Text('Your cart is empty. Add items from search results.'))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Multi-checkout', style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 8),
                        const Text(
                          'MedLens does not take payment. Open each pharmacy/retailer to complete purchase.',
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: () async {
                              final urls = uniqueUrls(items);
                              await openUrls(urls);
                            },
                            icon: const Icon(Icons.open_in_new),
                            label: const Text('Open all checkouts (staggered)'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                for (final entry in grouped.entries) ...[
                  _BucketCard(
                    title: _bucketTitle(entry.value.first),
                    source: entry.value.first.source,
                    lines: entry.value,
                    onOpenBucket: () => openUrls(uniqueUrls(entry.value)),
                  ),
                  const SizedBox(height: 12),
                ],
              ],
            ),
    );
  }
}

String _bucketTitle(CartLine line) {
  if (line.source == CartSource.local) return line.pharmacyName ?? 'Pharmacy';
  return line.onlineLabel ?? line.onlineProviderId ?? 'Online retailer';
}

class _BucketCard extends StatelessWidget {
  final String title;
  final CartSource source;
  final List<CartLine> lines;
  final VoidCallback onOpenBucket;

  const _BucketCard({
    required this.title,
    required this.source,
    required this.lines,
    required this.onOpenBucket,
  });

  @override
  Widget build(BuildContext context) {
    final cart = context.read<CartState>();
    double subtotal = 0;
    for (final l in lines) {
      subtotal += l.unitPriceInr * l.quantity;
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                ),
                TextButton(
                  onPressed: onOpenBucket,
                  child: Text(source == CartSource.local ? 'Open location' : 'Open retailer'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            for (final l in lines) ...[
              _LineRow(
                line: l,
                onQtyChanged: (q) => cart.setQty(l.lineId, q),
                onRemove: () => cart.remove(l.lineId),
              ),
              const Divider(height: 18),
            ],
            Align(
              alignment: Alignment.centerRight,
              child: Text('Subtotal: ₹${subtotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }
}

class _LineRow extends StatelessWidget {
  final CartLine line;
  final ValueChanged<int> onQtyChanged;
  final VoidCallback onRemove;

  const _LineRow({required this.line, required this.onQtyChanged, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(line.medicineLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
              if ((line.strength ?? '').trim().isNotEmpty)
                Text(line.strength!, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              const SizedBox(height: 4),
              Text('₹${line.unitPriceInr.toStringAsFixed(2)} each', style: const TextStyle(fontSize: 12)),
            ],
          ),
        ),
        const SizedBox(width: 10),
        SizedBox(
          width: 70,
          child: DropdownButtonFormField<int>(
            value: line.quantity,
            items: List.generate(10, (i) => i + 1)
                .map((q) => DropdownMenuItem(value: q, child: Text('x$q')))
                .toList(),
            onChanged: (v) {
              if (v != null) onQtyChanged(v);
            },
          ),
        ),
        IconButton(onPressed: onRemove, icon: const Icon(Icons.delete_outline)),
      ],
    );
  }
}

