import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Share,
  ActivityIndicator,
  SafeAreaView,
  Platform
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { listTokens, createToken, rotateToken, revokeToken } from '../services/api';
import { WEB_BASE_URL } from '../config';

interface DashboardScreenProps {
  user: any;
  onLogout: () => void;
  onViewHistory: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onLogout, onViewHistory }) => {
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [presence, setPresence] = useState<'available' | 'dnd'>('available');
  const [activeRawToken, setActiveRawToken] = useState<string | null>(null);

  const fetchUserTokens = async () => {
    setLoading(true);
    try {
      const res = await listTokens();
      setTokens(res.tokens || []);
    } catch (err: any) {
      console.error('Failed to list tokens:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserTokens();
  }, []);

  const activeToken = tokens.find((t) => t.is_active && !t.revoked_at);
  const fullCallUrl = activeRawToken
    ? `${WEB_BASE_URL}/call/${activeRawToken}`
    : activeToken
    ? `${WEB_BASE_URL}/call/${activeToken.id}`
    : 'No Active Link';

  const handleCreateToken = async () => {
    try {
      const res = await createToken('Private Link', 30);
      setActiveRawToken(res.token.raw_token);
      Alert.alert('Link Generated', `Your new private calling link has been created!`);
      fetchUserTokens();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to generate token');
    }
  };

  const handleRotateToken = async () => {
    if (!activeToken) {
      handleCreateToken();
      return;
    }

    Alert.alert(
      'Rotate Calling Link',
      'This will revoke your existing link and generate a brand new private URL.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate Now',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await rotateToken(activeToken.id);
              setActiveRawToken(res.new_token.raw_token);
              Alert.alert('Link Rotated', 'Old calling link revoked. New link is active!');
              fetchUserTokens();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to rotate token');
            }
          }
        }
      ]
    );
  };

  const handleRevokeToken = async () => {
    if (!activeToken) return;

    Alert.alert('Revoke Link', 'Are you sure you want to deactivate your calling link?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            await revokeToken(activeToken.id);
            setActiveRawToken(null);
            Alert.alert('Link Revoked', 'Calling link is now inactive.');
            fetchUserTokens();
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to revoke token');
          }
        }
      }
    ]);
  };

  const handleCopyLink = async () => {
    if (!activeRawToken && !activeToken) {
      Alert.alert('No Link Available', 'Please generate a calling link first.');
      return;
    }
    const urlToCopy = activeRawToken ? `http://192.168.0.122:3000/call/${activeRawToken}` : fullCallUrl;
    await Clipboard.setStringAsync(urlToCopy);
    Alert.alert('Copied to Clipboard', 'Private calling link copied successfully.');
  };

  const handleShareLink = async () => {
    if (!activeRawToken && !activeToken) return;
    const urlToShare = activeRawToken ? `http://192.168.0.122:3000/call/${activeRawToken}` : fullCallUrl;
    try {
      await Share.share({
        message: `Call me privately using this secure link: ${urlToShare}`
      });
    } catch (err: any) {
      console.error('Share error:', err);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome,</Text>
            <Text style={styles.ownerName}>{user?.display_name || 'Owner'}</Text>
          </View>
          <TouchableOpacity onPress={onLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {/* Presence Selector */}
        <View style={styles.presenceCard}>
          <Text style={styles.sectionTitle}>STATUS</Text>
          <View style={styles.presenceToggleRow}>
            <TouchableOpacity
              style={[styles.presenceBadge, presence === 'available' && styles.presenceActiveAvailable]}
              onPress={() => setPresence('available')}
            >
              <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
              <Text style={styles.presenceText}>Available</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.presenceBadge, presence === 'dnd' && styles.presenceActiveDnd]}
              onPress={() => setPresence('dnd')}
            >
              <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
              <Text style={styles.presenceText}>Do Not Disturb</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Private Call Link Card */}
        <View style={styles.linkCard}>
          <Text style={styles.sectionTitle}>YOUR PRIVATE CALL LINK</Text>
          <Text style={styles.linkDescription}>
            Guests open this link in any web browser to call you directly. No guest account required.
          </Text>

          <View style={styles.urlBox}>
            <Text style={styles.urlText} numberOfLines={1}>
              {fullCallUrl}
            </Text>
          </View>

          <View style={styles.actionGrid}>
            <TouchableOpacity style={styles.actionBtnPrimary} onPress={handleCopyLink}>
              <Text style={styles.actionBtnTextPrimary}>Copy Link</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleShareLink}>
              <Text style={styles.actionBtnTextSecondary}>Share Link</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionGridSub}>
            <TouchableOpacity style={styles.actionBtnSub} onPress={handleRotateToken}>
              <Text style={styles.actionBtnSubText}>Regenerate / Rotate</Text>
            </TouchableOpacity>

            {activeToken && (
              <TouchableOpacity style={styles.actionBtnRevoke} onPress={handleRevokeToken}>
                <Text style={styles.actionBtnRevokeText}>Revoke Link</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Navigation to Call History */}
        <TouchableOpacity style={styles.historyCard} onPress={onViewHistory}>
          <Text style={styles.historyTitle}>Call History</Text>
          <Text style={styles.historySubtitle}>View past completed, missed & declined calls →</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  greeting: {
    color: '#94a3b8',
    fontSize: 14,
  },
  ownerName: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: 'bold',
  },
  logoutButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  presenceCard: {
    backgroundColor: '#131c2e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#64748b',
    letterSpacing: 1,
    marginBottom: 12,
  },
  presenceToggleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  presenceBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 8,
  },
  presenceActiveAvailable: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  presenceActiveDnd: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  presenceText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
  linkCard: {
    backgroundColor: '#131c2e',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 20,
  },
  linkDescription: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 14,
    lineHeight: 18,
  },
  urlBox: {
    backgroundColor: '#090d16',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  urlText: {
    color: '#22c55e',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 13,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  actionBtnPrimary: {
    flex: 1,
    backgroundColor: '#16a34a',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnTextPrimary: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnTextSecondary: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  actionGridSub: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtnSub: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionBtnSubText: {
    color: '#38bdf8',
    fontSize: 13,
  },
  actionBtnRevoke: {
    paddingVertical: 10,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  actionBtnRevokeText: {
    color: '#ef4444',
    fontSize: 13,
  },
  historyCard: {
    backgroundColor: '#131c2e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  historyTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  historySubtitle: {
    color: '#94a3b8',
    fontSize: 13,
  },
});
