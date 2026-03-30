import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class MedLensApi {
  final String baseUrl;

  MedLensApi({required this.baseUrl});

  Uri _u(String path, [Map<String, String>? q]) {
    final b = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    final uri = Uri.parse('$b$path');
    return uri.replace(queryParameters: q);
  }

  Future<List<City>> getCities() async {
    final res = await http.get(_u('/api/cities'));
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw Exception(body['error'] ?? 'Failed to load cities');
    }
    final list = (body['cities'] as List<dynamic>? ?? []);
    return list.map((x) => City.fromJson(x as Map<String, dynamic>)).toList();
  }

  Future<List<LocalOffer>> searchLocal({required String q, required String citySlug}) async {
    final res = await http.get(_u('/api/compare/search', {'q': q, 'city': citySlug}));
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw Exception(body['error'] ?? 'Local search failed');
    }
    final list = (body['offers'] as List<dynamic>? ?? []);
    return list.map((x) => LocalOffer.fromJson(x as Map<String, dynamic>)).toList();
  }

  Future<List<OnlineProviderQuote>> searchOnline({required String q}) async {
    final res = await http.get(_u('/api/online/compare', {'q': q}));
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw Exception(body['error'] ?? 'Online search failed');
    }
    final list = (body['providers'] as List<dynamic>? ?? []);
    return list.map((x) => OnlineProviderQuote.fromJson(x as Map<String, dynamic>)).toList();
  }

  Future<GeocodeResult> reverseGeocode({required double lat, required double lng}) async {
    final res = await http.get(_u('/api/geocode/reverse', {'lat': '$lat', 'lng': '$lng'}));
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw Exception(body['error'] ?? body['hint'] ?? 'Geocoding failed');
    }
    return GeocodeResult.fromJson(body);
  }
}

