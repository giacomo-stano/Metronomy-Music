import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable as NativePressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { request, currentAccount } from './api';
import { useTheme } from './theme';
import StorageSection from './StorageSection';
import { useOffline } from './OfflineDownloads';
import Pressable from './SpringPressable';
import GlassBackground from './GlassBackground';

type Page = 'home' | 'server' | 'navidrome' | 'qobuz' | 'device' | 'appearance';
type ServerInfo = { navidromeURL?: string; version?: string; apiVersion?: string; username: string; admin: boolean; expires: number; folders: { id: string; label: string; libraryId: string; path: string; hostPath?: string; available: boolean }[] };
type QobuzInfo = { verified: boolean; username?: string; plan?: string; startDate?: string; endDate?: string; periodicity?: string; canceled?: boolean | null; message?: string };
const titles: Record<Page, string> = { home: 'Impostazioni', server: 'Server e libreria', navidrome: 'Navidrome', qobuz: 'Qobuz · qoget', device: 'Su questo iPhone', appearance: 'Aspetto' };
const dateLabel = (value?: string) => value ? new Date(value + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Non comunicata';
const bytesLabel = (value: number) => value >= 1073741824 ? (value / 1073741824).toFixed(2) + ' GB' : (value / 1048576).toFixed(1) + ' MB';

export default function SettingsScreen({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const { colors: c, mode, setMode, isDark } = useTheme();
  const { store: offline } = useOffline();
  const account = currentAccount();
  const localMode = !!account?.offline;
  const [page, setPage] = useState<Page>('home');
  const [visible, setVisible] = useState(true);
  const afterDismiss = useRef<(() => void) | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishDismiss = () => { const action = afterDismiss.current; afterDismiss.current = null; if (dismissTimer.current) clearTimeout(dismissTimer.current); action?.(); };
  const dismiss = (action: () => void) => { if (afterDismiss.current) return; afterDismiss.current = action; setVisible(false); dismissTimer.current = setTimeout(finishDismiss, 1200); };
  useEffect(() => () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); }, []);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState('Non verificato');
  const [online, setOnline] = useState(false);
  const [server, setServer] = useState<ServerInfo>();
  const [serverError, setServerError] = useState('');
  const [latency, setLatency] = useState('—');
  const [checked, setChecked] = useState('—');
  const [network, setNetwork] = useState('Non verificato');
  const [downloads, setDownloads] = useState('—');
  const [qobuz, setQobuz] = useState<QobuzInfo>();
  const [qBusy, setQBusy] = useState(false);
  const [qRevision, setQRevision] = useState(0);

  useEffect(() => {
    if (localMode) { setHealth('Modalità offline'); return; }
    let active = true;
    setBusy(true); setHealth('Verifica in corso…'); setOnline(false); setServer(undefined); setServerError(''); setLatency('—'); setNetwork('Verifica…'); setDownloads('—');
    const started = Date.now();
    Promise.all([
      request<{ status: string; navidrome: string }>('health').then(value => {
        if (!active) return;
        const ok = value.status === 'ok' && value.navidrome === 'ok';
        setOnline(ok); setHealth(ok ? 'Online' : 'Risposta inattesa'); setLatency((Date.now() - started) + ' ms');
      }).catch(() => { if (active) setHealth('Non raggiungibile / accesso negato'); }),
      request<ServerInfo>('settings/server', 25000).then(value => { if (active) setServer(value); }).catch(e => { if (active) setServerError(e.message); }),
      request<{ ready: boolean; message: string }>('network/status').then(value => { if (active) setNetwork(value.ready ? 'Configurato' : value.message || 'Da configurare'); }).catch(() => { if (active) setNetwork('Non disponibile'); }),
      request<{ jobs: { status: string }[] }>('network/downloads').then(value => { if (active) setDownloads(String(value.jobs.filter(j => j.status === 'queued' || j.status === 'downloading').length)); }).catch(() => {}),
    ]).finally(() => { if (active) { setBusy(false); setChecked(new Date().toLocaleTimeString('it-IT')); } });
    return () => { active = false; };
  }, [revision, localMode]);

  useEffect(() => {
    if (page !== 'qobuz' || localMode) return;
    let active = true;
    setQBusy(true); setQobuz(undefined);
    request<QobuzInfo>('settings/qobuz', 65000).then(value => { if (active) setQobuz(value); }).catch(e => { if (active) setQobuz({ verified: false, message: e.message }); }).finally(() => { if (active) setQBusy(false); });
    return () => { active = false; };
  }, [page, qRevision, localMode]);

  const tracks = Object.values(offline.tracks);
  const group = (children: ReactNode) => <View style={[s.group, { backgroundColor: c.surface }]}>{children}</View>;
  const note = (value: string) => <Text style={[s.note, { color: c.secondary }]}>{value}</Text>;
  const heading = (value: string) => <Text style={[s.heading, { color: c.secondary }]}>{value.toUpperCase()}</Text>;
  const row = (name: string, value?: string) => <View key={name} style={[s.row, { borderColor: c.border }]}><Text style={{ color: c.secondary, fontSize: 13 }}>{name}</Text><Text selectable style={{ color: c.text, fontSize: 16, marginTop: 5, lineHeight: 22 }}>{value || 'Non disponibile'}</Text></View>;
  const link = (target: Page, icon: keyof typeof Ionicons.glyphMap, color: string, subtitle: string) => <Pressable accessibilityRole="button" onPress={() => setPage(target)} style={[s.link, { borderColor: c.border }]}>
    <View style={[s.icon, { backgroundColor: color }]}><Ionicons name={icon} size={21} color="#fff" /></View>
    <View style={{ flex: 1 }}><Text style={{ color: c.text, fontSize: 17, fontWeight: '500' }}>{titles[target]}</Text><Text numberOfLines={2} style={{ color: c.secondary, marginTop: 4, fontSize: 13 }}>{subtitle}</Text></View>
    <Ionicons name="chevron-forward" size={17} color={c.muted} />
  </Pressable>;
  const refresh = <Pressable disabled={busy || localMode} accessibilityRole="button" onPress={() => setRevision(v => v + 1)} style={s.button}>{busy ? <ActivityIndicator color={c.accent} /> : <Text style={{ color: localMode ? c.secondary : c.accent, fontSize: 16 }}>Verifica connessioni</Text>}</Pressable>;
  const logout = <NativePressable disabled={!visible} accessibilityRole="button" onPress={() => dismiss(onLogout)} style={s.button}><Text style={{ color: c.accent, fontSize: 17 }}>Esci / Cambia account</Text></NativePressable>;

  return <Modal visible={visible} animationType="slide" onDismiss={finishDismiss} onRequestClose={() => page === 'home' ? dismiss(onClose) : setPage('home')}>
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <View style={s.navigation}>
        <Pressable accessibilityLabel={page === 'home' ? 'Chiudi impostazioni' : 'Torna alle impostazioni'} onPress={() => page === 'home' ? dismiss(onClose) : setPage('home')} style={s.circle}><GlassBackground /><Ionicons name={page === 'home' ? 'close' : 'chevron-back'} size={25} color={c.text} /></Pressable>
        <Text style={{ color: c.secondary, fontSize: 14 }}>Metronomy</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView key={page} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>{titles[page]}</Text>
        {page === 'home' && <>
          <View style={[s.summary, { backgroundColor: c.surface }]}>
            <View style={[s.avatar, { backgroundColor: c.accent }]}><Ionicons name="musical-notes" color="#fff" size={30} /></View>
            <View style={{ flex: 1 }}><Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{account?.username}</Text><Text style={{ color: c.secondary, marginTop: 5 }}>{localMode ? 'Archivio locale · iPhone' : 'La tua musica, sul tuo server'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: online ? '#30b85b' : c.muted }} /><Text style={{ color: c.secondary, fontSize: 12, flexShrink: 1 }}>{health}</Text></View>
            </View>
          </View>
          {heading('La tua musica')}
          {group(<>{link('server', 'server-outline', '#3478f6', 'Connessione, cartelle e spazio sul server')}{link('navidrome', 'person-outline', '#af52de', account?.username || 'Account e librerie autorizzate')}{link('qobuz', 'disc-outline', '#246b85', 'Account qoget e abbonamento')}</>)}
          {heading('La tua app')}
          {group(<>{link('device', 'download-outline', '#30a66c', tracks.length + ' brani salvati su iPhone')}{link('appearance', 'contrast-outline', '#737380', mode === 'system' ? 'Automatico' : mode === 'dark' ? 'Scuro' : 'Chiaro')}</>)}
          {logout}
          {note('Le copie locali restano sul telefono dopo il logout, accessibili da “Ascolta offline”.')}
        </>}
        {page === 'server' && <>
          {heading('Connessione')}
          {group(<>{row('Bridge e Navidrome', health)}{row('Indirizzo del bridge', account?.baseURL)}{row('Tempo di risposta', latency)}{row('Ultimo controllo', checked)}</>)}
          {refresh}
          {note('Un errore di rete o di autorizzazione non permette di stabilire se il server sia spento.')}
          {heading('Cartelle della tua musica')}
          {server?.folders.map(folder => <View key={folder.id} style={{ marginBottom: 12 }}>{group(<>{row(folder.label, folder.available ? 'Cartella accessibile' : 'Cartella non accessibile dal bridge')}{folder.hostPath && row('Percorso sul server · configurato', folder.hostPath)}{row('Percorso nel container bridge', folder.path)}{row('ID libreria Navidrome', folder.libraryId)}</>)}</View>)}
          {!server && note(localMode ? 'Accedi online per verificare cartelle e catalogo del server.' : serverError || 'Caricamento cartelle…')}
          {note('qoget salva i nuovi download nella cartella autorizzata scelta per questo account. I percorsi del container possono essere diversi da quelli del server Linux.')}
          {!localMode && <StorageSection />}
        </>}
        {page === 'navidrome' && <>
          {heading('Il tuo account')}
          {group(<>{row('Nome utente', server?.username || account?.username)}{row('Accesso', localMode ? 'Offline · nessuna sessione server' : (server?.admin ?? account?.admin) ? 'Amministratore' : 'Utente')}{!localMode && row('Scadenza sessione Metronomy', new Date((server?.expires ?? account?.expires ?? 0) * 1000).toLocaleString('it-IT'))}{row('Librerie autorizzate', server?.folders.map(f => f.label).join(', ') || account?.destinations.map(d => d.label).join(', ') || (localMode ? 'Solo copie locali di questo account' : 'Nessuna'))}</>)}
          {heading('Servizio musicale')}
          {group(<>{row('URL Navidrome', server?.navidromeURL)}{row('Versione Navidrome', server?.version)}{row('Versione API Subsonic', server?.apiVersion)}</>)}
          {!!serverError && note(serverError)}
          {note('Musica, preferiti e permessi appartengono a questo account Navidrome. L’account Qobuz di qoget è separato. La password non viene salvata nell’app.')}
          {refresh}{logout}
        </>}
        {page === 'qobuz' && <>
          {note('Account Qobuz configurato su qoget nel server, condiviso da chi usa questa installazione. Non è il tuo account Navidrome.')}
          {heading('Adattatore qoget')}
          {group(<>{row('Configurazione locale', localMode ? 'Non verificata · offline' : network)}{row('Download sul server in corso per te', downloads)}</>)}
          {heading('Account e abbonamento')}
          {qBusy ? <View style={s.button}><ActivityIndicator color={c.accent} /><Text style={{ color: c.secondary, marginTop: 12 }}>Verifica account Qobuz…</Text></View> : qobuz?.verified ? group(<>{row('Connessione account', 'Verificato con Qobuz')}{row('Utente', qobuz.username)}{row('Piano', qobuz.plan)}{row('Periodicità', qobuz.periodicity)}{row('Inizio periodo', dateLabel(qobuz.startDate))}{row('Scadenza periodo', dateLabel(qobuz.endDate))}{row('Disdetta comunicata', qobuz.canceled === true ? 'Sì' : qobuz.canceled === false ? 'No' : 'Non comunicata')}</>) : note(localMode ? 'Accedi online per consultare l’account Qobuz.' : qobuz?.message || 'Informazioni non disponibili.')}
          {!localMode && <Pressable disabled={qBusy} onPress={() => setQRevision(v => v + 1)} style={s.button}><Text style={{ color: c.accent, fontSize: 16 }}>Aggiorna account Qobuz</Text></Pressable>}
          {note('La data indica la fine del periodo comunicata da Qobuz, non garantisce il rinnovo. I dati mancanti non vengono stimati. Token, password e dati di pagamento non sono mostrati.')}
        </>}
        {page === 'device' && <>
          {heading('Disponibili senza internet')}
          {group(<>{row('Brani', String(tracks.length))}{row('Dimensione file audio', bytesLabel(tracks.reduce((sum, t) => sum + t.bytes, 0)))}{row('Copertine salvate', String(tracks.filter(t => t.cover).length))}{row('Testi salvati', String(tracks.filter(t => t.lyrics?.lyrics.some(l => l.line?.length)).length))}</>)}
          {!localMode && <Pressable disabled={offline.syncing || !offline.ready} onPress={() => void offline.syncExtras()} style={s.button}><Text style={{ color: c.accent }}>{offline.syncing ? 'Completamento in corso…' : 'Completa copertine e testi offline'}</Text></Pressable>}
          {!!offline.syncMessage && note(offline.syncMessage)}
          {note('Questi file sono salvati sull’iPhone, non sono il catalogo del server. Puoi rimuovere una copia dal menu del brano senza cancellarla da Navidrome.')}
          {localMode && note('Per completare copertine e testi mancanti, esci e accedi online.')}
        </>}
        {page === 'appearance' && <>
          {note('Scegli il tema oppure segui automaticamente l’aspetto del tuo iPhone.')}
          {group(<>{(['system', 'light', 'dark'] as const).map((value, i) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: mode === value }} onPress={() => setMode(value)} style={s.link}><Ionicons name={i === 0 ? 'phone-portrait-outline' : i === 1 ? 'sunny-outline' : 'moon-outline'} size={23} color={c.accent} /><Text style={{ color: c.text, flex: 1, fontSize: 17 }}>{['Automatico', 'Chiaro', 'Scuro'][i]}</Text>{mode === value && <Ionicons name="checkmark" size={24} color={c.accent} />}</Pressable>)}</>)}
          <View style={[s.summary, { marginTop: 24, borderWidth: .5, borderColor: c.border, backgroundColor: c.surface }]}><View style={s.circle}><GlassBackground /><Ionicons name="musical-note" color={c.accent} size={24} /></View><View><Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>La tua musica</Text><Text style={{ color: c.secondary, marginTop: 4 }}>Aspetto {isDark ? 'scuro' : 'chiaro'} attivo</Text></View></View>
        </>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  navigation: { paddingHorizontal: 20, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circle: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 22, paddingBottom: 48 },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -.8, marginTop: 14, marginBottom: 24 },
  summary: { borderRadius: 24, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 60, height: 60, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 12, letterSpacing: .8, marginTop: 28, marginBottom: 10, marginLeft: 16 },
  group: { borderRadius: 20, overflow: 'hidden' },
  row: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: .5 },
  link: { minHeight: 70, paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 13, lineHeight: 20, marginHorizontal: 14, marginTop: 12 },
  button: { minHeight: 52, padding: 18, alignItems: 'center', justifyContent: 'center' },
});
