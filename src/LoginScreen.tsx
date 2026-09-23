import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { login, type Account } from './api';
import { useTheme } from './theme';
import { offlineProfiles, offlineAccount, type OfflineProfile } from './offlineProfiles';
import Pressable from './SpringPressable';

export default function LoginScreen({ onLogin }: { onLogin: (account: Account) => void }) {
  const { colors: c, isDark } = useTheme();
  const { height } = useWindowDimensions();
  const compact = height < 900;
  const small = height < 700;
  const tight = compact;
  const [offlinePage, setOfflinePage] = useState(0);
  const [url, setURL] = useState(process.env.EXPO_PUBLIC_METRONOMY_BASE_URL || 'http://192.168.1.24:8180');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const confirming = useRef(false);
  const [error, setError] = useState('');
  const [profiles, setProfiles] = useState<OfflineProfile[]>([]);
  const [checking, setChecking] = useState(true);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const usernameInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const valid = !!url.trim() && !!username.trim() && !!password;
  useEffect(() => { let active = true; offlineProfiles().then(values => { if (active) setProfiles(values); }).finally(() => { if (active) setChecking(false); }).catch(() => {}); return () => { active = false; }; }, []);
  async function submit() {
    if (pending.current || !valid) return;
    pending.current = true; setBusy(true); setError('');
    try { const result = await login(url, username, password); setPassword(''); onLogin(result); }
    catch (e) { Keyboard.dismiss(); setError(e instanceof Error ? e.message : 'Connessione non riuscita.'); }
    finally { pending.current = false; setBusy(false); }
  }
  function confirm() {
    if (!valid || pending.current || confirming.current) return;
    if (url.trim().toLowerCase().startsWith('http:')) {
      confirming.current = true;
      Alert.alert('Connessione non cifrata', 'Usa HTTP soltanto sulla rete domestica fidata o in VPN: le credenziali viaggiano senza cifratura. Per accessi esterni usa HTTPS.', [
        { text: 'Annulla', style: 'cancel', onPress: () => { confirming.current = false; } },
        { text: 'Accedi sulla rete fidata', onPress: () => { confirming.current = false; void submit(); } },
      ], { cancelable: true, onDismiss: () => { confirming.current = false; } });
    } else void submit();
  }
  const inputStyle = [s.input, { color: c.text }, tight && { minHeight: 44, paddingVertical: 8 }];
  const labelStyle = [s.label, { color: c.secondary }, tight && { marginTop: 12, marginBottom: 6 }];
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
    <LinearGradient pointerEvents="none" colors={isDark ? ['#39121e', '#130c12', c.background] : ['#fff0f3', '#fff9fa', c.background]} locations={[0, .42, 1]} style={StyleSheet.absoluteFill} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[s.content, { paddingVertical: 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.body}>
          <View style={[s.hero, { marginBottom: compact ? 16 : 28 }]}>
            {!small && <View style={[s.iconShadow, { shadowColor: '#ba2448' }]}><Image source={require('../assets/metronomy-icon-v1.png')} accessibilityLabel="Icona Metronomy" style={{ width: compact ? 64 : 100, height: compact ? 64 : 100, borderRadius: compact ? 16 : 25 }} /></View>}
            <Text accessibilityRole="header" style={[s.brand, { color: c.text }, compact && { fontSize: 32, marginTop: small ? 0 : 10 }]}>Metronomy</Text>
            {!small && <Text style={[s.tagline, { color: c.secondary }]}>La tua musica. Il tuo ritmo.</Text>}
          </View>
          <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }, tight && { padding: 16 }]}>
            <Text style={[s.cardTitle, { color: c.text }]}>Bentornato</Text>
            {!small && <Text style={[s.subtitle, { color: c.secondary }]}>Accedi con il tuo account Navidrome.</Text>}
            <Text style={labelStyle}>SERVER METRONOMY</Text>
            <View style={[s.field, { borderColor: c.border, backgroundColor: c.background }, tight && { minHeight: 44 }]}>
              <Ionicons name="server-outline" size={19} color={c.secondary} />
              <TextInput accessibilityLabel="URL server Metronomy" editable={!busy} style={[inputStyle, { fontSize: 15 }]} value={url} onChangeText={setURL} placeholder="https://musica.example.com" placeholderTextColor={c.secondary} keyboardType="url" autoCapitalize="none" autoCorrect={false} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => usernameInput.current?.focus()} />
            </View>
            {!small && <Text style={[s.hint, { color: c.secondary }]}>Indirizzo del bridge · di solito porta 8180</Text>}
            <Text style={labelStyle}>ACCOUNT</Text>
            <View style={[s.credentials, { borderColor: c.border, backgroundColor: c.background }]}>
              <View style={s.credentialRow}>
                <Ionicons name="person-outline" size={19} color={c.secondary} />
                <TextInput ref={usernameInput} accessibilityLabel="Utente Navidrome" editable={!busy} style={inputStyle} placeholder="Nome utente" placeholderTextColor={c.secondary} value={username} onChangeText={setUsername} textContentType="username" autoCapitalize="none" autoCorrect={false} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordInput.current?.focus()} />
              </View>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 46 }} />
              <View style={s.credentialRow}>
                <Ionicons name="lock-closed-outline" size={19} color={c.secondary} />
                <TextInput ref={passwordInput} accessibilityLabel="Password Navidrome" editable={!busy} style={inputStyle} placeholder="Password" placeholderTextColor={c.secondary} value={password} onChangeText={setPassword} textContentType="password" autoCapitalize="none" autoCorrect={false} secureTextEntry={!showPassword} returnKeyType="go" onSubmitEditing={confirm} />
                <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={showPassword ? 'Nascondi password' : 'Mostra password'} onPress={() => setShowPassword(v => !v)} style={s.eye}><Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.secondary} /></Pressable>
              </View>
            </View>
            {!!error && <View style={[s.error, { borderColor: c.accent }]}><Ionicons name="alert-circle-outline" size={19} color={c.accent} /><Text accessibilityLiveRegion="polite" numberOfLines={2} onPress={() => Alert.alert('Accesso non riuscito', error)} style={{ color: c.text, flex: 1, fontSize: 13, lineHeight: 19 }}>{error}</Text></View>}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !valid, busy }} disabled={busy || !valid} onPress={confirm} style={[s.submit, { backgroundColor: c.accent, opacity: busy || !valid ? .5 : 1 }, tight && { marginTop: 14, minHeight: 48, paddingVertical: 12 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <><Text style={s.submitText}>Accedi</Text><Ionicons name="arrow-forward" size={20} color="#fff" /></>}
            </Pressable>
          </View>
          {checking && <Text style={[s.footer, { color: c.secondary }]}>Verifica musica scaricata…</Text>}
          {!!profiles.length && <View style={[s.offline, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: offlineOpen, disabled: busy }} disabled={busy} onPress={() => { Keyboard.dismiss(); setOfflinePage(0); setOfflineOpen(true); }} style={[s.offlineButton, tight && { minHeight: 62, padding: 12 }]}>
              <View style={[s.offlineIcon, { backgroundColor: c.background }]}><Ionicons name="download-outline" color={c.accent} size={21} /></View>
              <View style={{ flex: 1 }}><Text style={{ color: c.text, fontWeight: '600', fontSize: 16 }}>Ascolta offline</Text><Text style={{ color: c.secondary, fontSize: 12, marginTop: 4 }}>La musica già sul tuo iPhone</Text></View>
              <Ionicons name={offlineOpen ? 'chevron-up' : 'chevron-down'} color={c.secondary} size={17} />
            </Pressable>

          </View>}
          {!small && <Text style={[s.footer, { color: c.secondary }]}>La password non viene salvata nell’app.{"\n"}Usa la rete domestica, una VPN o HTTPS.</Text>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    {offlineOpen && <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, { backgroundColor: c.background, justifyContent: 'center', padding: 24 }]}>
      <View style={[s.card, s.body, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text accessibilityRole="header" style={[s.cardTitle, { color: c.text }]}>Ascolta offline</Text>
        <Text style={[s.subtitle, { color: c.secondary, marginBottom: 20 }]}>Scegli la musica salvata su questo iPhone.</Text>
        {profiles.slice(offlinePage * 2, offlinePage * 2 + 2).map(profile => <Pressable key={profile.baseURL + profile.username} onPress={() => onLogin(offlineAccount(profile))} style={[s.profile, { borderColor: c.border }]} accessibilityRole="button"><Text style={{ color: c.accent, fontSize: 16 }}>{profile.username} · {profile.count} brani</Text><Text numberOfLines={1} style={{ color: c.secondary, fontSize: 12, marginTop: 4 }}>{profile.baseURL}</Text></Pressable>)}
        {profiles.length > 2 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
          <Pressable disabled={offlinePage === 0} onPress={() => setOfflinePage(v => v - 1)} style={{ padding: 12 }}><Text style={{ color: offlinePage ? c.accent : c.secondary }}>Precedente</Text></Pressable>
          <Pressable disabled={(offlinePage + 1) * 2 >= profiles.length} onPress={() => setOfflinePage(v => v + 1)} style={{ padding: 12 }}><Text style={{ color: (offlinePage + 1) * 2 < profiles.length ? c.accent : c.secondary }}>Successivo</Text></Pressable>
        </View>}
        <Text style={[s.footer, { color: c.secondary }]}>Solo copie locali, senza accesso al server. Chi sblocca l’iPhone può ascoltarle.</Text>
        <Pressable accessibilityRole="button" onPress={() => setOfflineOpen(false)} style={{ alignItems: 'center', padding: 16, marginTop: 8 }}><Text style={{ color: c.accent, fontSize: 17 }}>Torna al login</Text></Pressable>
      </View>
    </View>}
  </SafeAreaView>;
}

const s = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  body: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  hero: { alignItems: 'center' },
  iconShadow: { shadowOpacity: .2, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
  brand: { fontSize: 36, fontWeight: '700', letterSpacing: -1.2, marginTop: 17 },
  tagline: { fontSize: 16, marginTop: 7 },
  card: { padding: 22, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth },
  cardTitle: { fontSize: 23, fontWeight: '700', letterSpacing: -.4 },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  label: { fontSize: 10, fontWeight: '600', letterSpacing: 1.2, marginTop: 22, marginBottom: 9 },
  field: { minHeight: 52, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  input: { flex: 1, minWidth: 0, minHeight: 52, paddingVertical: 12, fontSize: 16 },
  hint: { fontSize: 11, marginTop: 7, marginLeft: 2 },
  credentials: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  credentialRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, gap: 10 },
  eye: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderLeftWidth: 2, paddingLeft: 10, marginTop: 16 },
  submit: { minHeight: 54, paddingVertical: 15, paddingHorizontal: 20, marginTop: 22, borderRadius: 17, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  submitText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  offline: { marginTop: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  offlineButton: { minHeight: 78, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  offlineIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  profile: { paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  footer: { fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 12, paddingHorizontal: 14 },
});
