import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView
} from 'react-native';
import { fetchCallHistory } from '../services/api';

interface CallHistoryScreenProps {
  onBack: () => void;
}

export const CallHistoryScreen: React.FC<CallHistoryScreenProps> = ({ onBack }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await fetchCallHistory();
      setHistory(res.history || []);
    } catch (err: any) {
      console.error('Failed to load call history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const formatDuration = (secs: number) => {
    if (!secs || secs <= 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ended':
      case 'connected':
        return '#22c55e';
      case 'missed':
        return '#f59e0b';
      case 'declined':
      case 'busy':
        return '#ef4444';
      default:
        return '#94a3b8';
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.historyCard}>
      <View style={styles.cardHeader}>
        <View style={styles.callTypeContainer}>
          <Text style={styles.icon}>{item.call_type === 'video' ? '🎥' : '📞'}</Text>
          <Text style={styles.callTypeText}>
            Incoming {item.call_type === 'video' ? 'Video' : 'Voice'}
          </Text>
        </View>
        <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
          {item.status.toUpperCase()}
        </Text>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.timeText}>
          {new Date(item.created_at).toLocaleString()}
        </Text>
        <Text style={styles.durationText}>
          Duration: {formatDuration(item.duration_seconds)}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Call History</Text>
        <TouchableOpacity onPress={loadHistory} style={styles.refreshButton}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#22c55e" size="large" />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No past call history records found.</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.call_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  backButton: {
    paddingVertical: 6,
  },
  backText: {
    color: '#38bdf8',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: 'bold',
  },
  refreshButton: {
    paddingVertical: 6,
  },
  refreshText: {
    color: '#22c55e',
    fontSize: 14,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  historyCard: {
    backgroundColor: '#131c2e',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  callTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    fontSize: 18,
  },
  callTypeText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  durationText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '500',
  },
});
