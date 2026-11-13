import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';
import { api } from '@/src/api/client';

interface ReaderMessage {
  type: string;
  cfi?: string;
  fraction?: number;
  message?: string;
}

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const hasOpened = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCfi = useRef<string | null>(null);
  const lastFraction = useRef<number | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const serverUrl = serverUrlStore.get() ?? '';
  const token = tokenStore.get() ?? '';
  const bookUrl = `${serverUrl}/api/v1/books/${id}/file`;
  const readerUrl = `${serverUrl}/reader.html`;

  // Set window.__LITARA__ before any page scripts run.
  const preloadScript = `
    (function() {
      window.__LITARA__ = {
        bookUrl: ${JSON.stringify(bookUrl)},
        token: ${JSON.stringify(token)},
      };
    })();
    true;
  `;

  const sendToReader = useCallback((msg: object) => {
    const payload = JSON.stringify(msg);
    webViewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${payload}}));true;`,
    );
  }, []);

  const saveProgress = useCallback(
    (cfi: string, fraction: number) => {
      lastCfi.current = cfi;
      lastFraction.current = fraction;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        api
          .patch(`/books/${id}/progress`, {
            location: cfi,
            percentage: fraction,
            source: 'LITARA',
          })
          .catch(() => {});
      }, 1500);
    },
    [id],
  );

  // Idempotent open — called by iframeReady or fallback timer.
  const openBook = useCallback(async () => {
    if (hasOpened.current) return;
    hasOpened.current = true;

    let cfi: string | null = null;
    try {
      const res = await api.get<{ location: string } | null>(
        `/books/${id}/progress?source=LITARA`,
      );
      cfi = res.data?.location ?? null;
    } catch {
      // proceed without saved position
    }

    sendToReader({ type: 'open', url: bookUrl, cfi });
  }, [id, bookUrl, sendToReader]);

  // Drop the loading spinner after 10 s regardless — book rendering is hard to detect
  // reliably across all formats. Errors clear it immediately.
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 10000);
    return () => clearTimeout(t);
  }, []);

  // Flush progress on unmount
  useEffect(() => {
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (lastCfi.current && id) {
        api
          .patch(`/books/${id}/progress`, {
            location: lastCfi.current,
            percentage: lastFraction.current ?? 0,
            source: 'LITARA',
          })
          .catch(() => {});
      }
    };
  }, [id]);

  const handleLoadEnd = useCallback(() => {
    // Inject auth token into localStorage — production reader-init.js reads
    // localStorage.getItem('token') to authenticate the book file fetch.
    webViewRef.current?.injectJavaScript(
      `window.__LITARA__=${JSON.stringify({ bookUrl, token })};localStorage.setItem('token',${JSON.stringify(token)});true;`,
    );

    // Production reader-init.js uses window.parent.postMessage for all notifications.
    // In a top-level WebView window.parent===window, but Android WebView bypasses
    // property overrides on window when calling through window.parent, so patching
    // window.postMessage doesn't work. Instead, listen for the resulting 'message'
    // DOM event and forward it through the native bridge.
    // Messages we inject via dispatchEvent have source===null; postMessage calls
    // from reader-init.js have source===window — use that to avoid echoing our own traffic.
    webViewRef.current?.injectJavaScript(`
      (function() {
        if (!window.ReactNativeWebView) return;
        window.addEventListener('message', function(e) {
          if (e.source === null) return;
          try {
            var s = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
            window.ReactNativeWebView.postMessage(s);
          } catch(_) {}
        });
      })(); true;
    `);

    // If iframeReady is lost due to a race with the patch, open after 4 s anyway.
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(() => openBook(), 4000);
  }, [bookUrl, token, openBook]);

  const handleMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      let msg: ReaderMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as ReaderMessage;
      } catch {
        return;
      }

      if (msg.type === 'log') {
        console.log('[WebView]', msg.message);
      } else if (msg.type === 'iframeReady') {
        if (fallbackTimer.current) {
          clearTimeout(fallbackTimer.current);
          fallbackTimer.current = null;
        }
        openBook();
      } else if (msg.type === 'relocate' && msg.cfi) {
        saveProgress(msg.cfi, msg.fraction ?? 0);
      } else if (msg.type === 'escape') {
        router.back();
      } else if (msg.type === 'error') {
        setLoading(false);
        setError(msg.message ?? 'Failed to open book');
      }
    },
    [openBook, saveProgress],
  );

  const toggleToolbar = () => setShowToolbar((v) => !v);

  if (!serverUrl) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No server configured</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        style={styles.webview}
        source={{ uri: readerUrl }}
        injectedJavaScriptBeforeContentLoaded={preloadScript}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        allowFileAccess={false}
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        onTouchStart={toggleToolbar}
      />

      {/* Loading overlay — visible until the first relocate event */}
      {loading && !error && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4a9eff" />
        </View>
      )}

      {/* Error overlay */}
      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.errorBtn} onPress={() => router.back()}>
            <Text style={styles.errorBtnText}>Go back</Text>
          </Pressable>
        </View>
      )}

      {/* Floating toolbar — auto-hides on tap */}
      {showToolbar && !error && (
        <View style={[styles.toolbar, { paddingTop: insets.top }]}>
          <Pressable
            style={styles.toolbarBtn}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>

          <View style={styles.toolbarSpacer} />

          <Pressable
            style={styles.toolbarBtn}
            onPress={() => sendToReader({ type: 'prev' })}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Pressable
            style={styles.toolbarBtn}
            onPress={() => sendToReader({ type: 'next' })}
            hitSlop={8}
          >
            <Ionicons name="chevron-forward" size={22} color="#fff" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
  },
  toolbarBtn: {
    padding: 10,
    borderRadius: 8,
  },
  toolbarSpacer: {
    flex: 1,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 32,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 15,
    textAlign: 'center',
  },
  errorBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
  },
  errorBtnText: {
    color: '#4a9eff',
    fontSize: 14,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
});
