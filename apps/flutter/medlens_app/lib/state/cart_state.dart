import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum CartSource { local, online }

class CartLine {
  final String lineId;
  final CartSource source;
  final int medicineId; // 0 if query-based (online)
  final String medicineLabel;
  final String? strength;
  final String? searchQuery; // for online query-based merges

  final double unitPriceInr;
  final double? mrpInr;
  final int quantity;

  // local bucket
  final int? pharmacyId;
  final String? pharmacyName;
  final String? addressLine;
  final String? pincode;
  final String? citySlug;

  // online bucket
  final String? onlineProviderId;
  final String? onlineLabel;

  final String checkoutUrl;

  CartLine({
    required this.lineId,
    required this.source,
    required this.medicineId,
    required this.medicineLabel,
    required this.strength,
    required this.searchQuery,
    required this.unitPriceInr,
    required this.mrpInr,
    required this.quantity,
    required this.pharmacyId,
    required this.pharmacyName,
    required this.addressLine,
    required this.pincode,
    required this.citySlug,
    required this.onlineProviderId,
    required this.onlineLabel,
    required this.checkoutUrl,
  });

  Map<String, dynamic> toJson() => {
        'lineId': lineId,
        'source': source.name,
        'medicineId': medicineId,
        'medicineLabel': medicineLabel,
        'strength': strength,
        'searchQuery': searchQuery,
        'unitPriceInr': unitPriceInr,
        'mrpInr': mrpInr,
        'quantity': quantity,
        'pharmacyId': pharmacyId,
        'pharmacyName': pharmacyName,
        'addressLine': addressLine,
        'pincode': pincode,
        'citySlug': citySlug,
        'onlineProviderId': onlineProviderId,
        'onlineLabel': onlineLabel,
        'checkoutUrl': checkoutUrl,
      };

  factory CartLine.fromJson(Map<String, dynamic> j) {
    double num0(dynamic x) => double.tryParse(x.toString()) ?? 0;
    double? numN(dynamic x) => x == null ? null : double.tryParse(x.toString());
    int int0(dynamic x) => int.tryParse(x.toString()) ?? 0;
    return CartLine(
      lineId: (j['lineId'] ?? '').toString(),
      source: (j['source'] ?? 'local').toString() == 'online' ? CartSource.online : CartSource.local,
      medicineId: int0(j['medicineId']),
      medicineLabel: (j['medicineLabel'] ?? '').toString(),
      strength: j['strength']?.toString(),
      searchQuery: j['searchQuery']?.toString(),
      unitPriceInr: num0(j['unitPriceInr']),
      mrpInr: numN(j['mrpInr']),
      quantity: int0(j['quantity']).clamp(1, 99),
      pharmacyId: j['pharmacyId'] == null ? null : int0(j['pharmacyId']),
      pharmacyName: j['pharmacyName']?.toString(),
      addressLine: j['addressLine']?.toString(),
      pincode: j['pincode']?.toString(),
      citySlug: j['citySlug']?.toString(),
      onlineProviderId: j['onlineProviderId']?.toString(),
      onlineLabel: j['onlineLabel']?.toString(),
      checkoutUrl: (j['checkoutUrl'] ?? '').toString(),
    );
  }
}

class CartState extends ChangeNotifier {
  static const _kKey = 'medlens_flutter_cart_v1';
  final List<CartLine> _items = [];

  List<CartLine> get items => List.unmodifiable(_items);

  int get totalQty => _items.fold<int>(0, (s, x) => s + x.quantity);

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kKey);
    if (raw == null || raw.trim().isEmpty) return;
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      final list = (j['items'] as List<dynamic>? ?? []);
      _items
        ..clear()
        ..addAll(list.map((x) => CartLine.fromJson(x as Map<String, dynamic>)));
      notifyListeners();
    } catch {
      // ignore
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = jsonEncode({'items': _items.map((x) => x.toJson()).toList(), 'updated_at': DateTime.now().millisecondsSinceEpoch});
    await prefs.setString(_kKey, raw);
  }

  bool _sameLine(CartLine i, CartLine line) {
    if (i.source != line.source) return false;
    if (line.source == CartSource.local) {
      return i.medicineId == line.medicineId && i.pharmacyId == line.pharmacyId;
    }
    if (i.onlineProviderId != line.onlineProviderId) return false;
    if (i.medicineId > 0 && line.medicineId > 0) return i.medicineId == line.medicineId;
    if (i.medicineId > 0 || line.medicineId > 0) return false;
    final qi = (i.searchQuery ?? '').toLowerCase();
    final ql = (line.searchQuery ?? '').toLowerCase();
    final li = i.medicineLabel.toLowerCase();
    final ll = line.medicineLabel.toLowerCase();
    return ql.isNotEmpty && qi == ql && li == ll;
  }

  Future<void> addLine(CartLine line, {int qty = 1}) async {
    final q = qty.clamp(1, 99);
    final idx = _items.indexWhere((x) => _sameLine(x, line));
    if (idx >= 0) {
      final cur = _items[idx];
      _items[idx] = CartLine(
        lineId: cur.lineId,
        source: cur.source,
        medicineId: cur.medicineId,
        medicineLabel: cur.medicineLabel,
        strength: cur.strength,
        searchQuery: cur.searchQuery,
        unitPriceInr: cur.unitPriceInr,
        mrpInr: cur.mrpInr,
        quantity: (cur.quantity + q).clamp(1, 99),
        pharmacyId: cur.pharmacyId,
        pharmacyName: cur.pharmacyName,
        addressLine: cur.addressLine,
        pincode: cur.pincode,
        citySlug: cur.citySlug,
        onlineProviderId: cur.onlineProviderId,
        onlineLabel: cur.onlineLabel,
        checkoutUrl: cur.checkoutUrl,
      );
    } else {
      _items.add(line);
    }
    notifyListeners();
    await _save();
  }

  Future<void> setQty(String lineId, int qty) async {
    final q = qty.clamp(1, 99);
    final idx = _items.indexWhere((x) => x.lineId == lineId);
    if (idx < 0) return;
    final cur = _items[idx];
    _items[idx] = CartLine(
      lineId: cur.lineId,
      source: cur.source,
      medicineId: cur.medicineId,
      medicineLabel: cur.medicineLabel,
      strength: cur.strength,
      searchQuery: cur.searchQuery,
      unitPriceInr: cur.unitPriceInr,
      mrpInr: cur.mrpInr,
      quantity: q,
      pharmacyId: cur.pharmacyId,
      pharmacyName: cur.pharmacyName,
      addressLine: cur.addressLine,
      pincode: cur.pincode,
      citySlug: cur.citySlug,
      onlineProviderId: cur.onlineProviderId,
      onlineLabel: cur.onlineLabel,
      checkoutUrl: cur.checkoutUrl,
    );
    notifyListeners();
    await _save();
  }

  Future<void> remove(String lineId) async {
    _items.removeWhere((x) => x.lineId == lineId);
    notifyListeners();
    await _save();
  }

  Future<void> clear() async {
    _items.clear();
    notifyListeners();
    await _save();
  }
}

