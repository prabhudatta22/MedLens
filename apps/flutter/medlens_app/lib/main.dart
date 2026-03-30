import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app_theme.dart';
import 'state/cart_state.dart';
import 'state/settings_state.dart';
import 'ui/search_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MedLensApp());
}

class MedLensApp extends StatelessWidget {
  const MedLensApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => SettingsState()..load()),
        ChangeNotifierProvider(create: (_) => CartState()..load()),
      ],
      child: MaterialApp(
        title: 'MedLens',
        theme: AppTheme.light(),
        home: const SearchScreen(),
      ),
    );
  }
}

