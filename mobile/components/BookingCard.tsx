// components/BookingCard.tsx — dynamic booking card for the chat interface.
//
// Pure presentation: it renders a booking object and, for admins, exposes action
// buttons via onAction. Business logic (API calls, optimistic state) lives in the
// useBookingActions hook — see the example at the bottom.
import React from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView } from 'react-native';
import { StatusPill } from './StatusPill';
import type { BookingStatus } from '../api/bookingStatus';

export type Booking = {
  id: string;          // DB id (used for status calls)
  ref?: string;        // human HM-… reference
  name: string;
  phone?: string;
  fromAddr: string;
  toAddr?: string;
  date: string;        // YYYY-MM-DD
  time?: string;       // band or HH:MM
  status: BookingStatus | string;
  items?: string[];
  photos?: string[];   // image URLs
};

export type CardAction = 'accept' | 'cancel' | 'request_changes';

export function BookingCard(props: {
  booking: Booking;
  role?: 'admin' | 'customer';
  busy?: boolean;
  onAction?: (action: CardAction, booking: Booking) => void;
}) {
  const { booking: b, role = 'customer', busy = false, onAction } = props;
  const route = b.toAddr ? `${b.fromAddr} → ${b.toAddr}` : b.fromAddr;
  const isAdmin = role === 'admin';
  const closed = b.status === 'cancelled' || b.status === 'completed' || b.status === 'rejected';

  const Row = ({ label, value }: { label: string; value?: string }) =>
    value ? (
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    ) : null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Booking #{b.ref || b.id}</Text>
        <StatusPill status={b.status} />
      </View>

      <Row label="お名前" value={b.name} />
      <Row label="電話" value={b.phone} />
      <Row label="ルート" value={route} />
      <Row label="希望日" value={b.date} />
      <Row label="時間" value={b.time} />

      {!!b.items?.length && (
        <View style={styles.row}>
          <Text style={styles.label}>荷物</Text>
          <Text style={styles.value}>{b.items.join('・')}</Text>
        </View>
      )}

      {!!b.photos?.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photos}>
          {b.photos.map((u, i) => (
            <Image key={i} source={{ uri: u }} style={styles.photo} />
          ))}
        </ScrollView>
      )}

      {isAdmin && !closed && (
        <View style={styles.actions}>
          <Pressable
            disabled={busy}
            onPress={() => onAction?.('accept', b)}
            style={[styles.btn, styles.accept, busy && styles.btnDisabled]}>
            <Text style={styles.acceptText}>承認 Accept</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => onAction?.('request_changes', b)}
            style={[styles.btn, styles.revise, busy && styles.btnDisabled]}>
            <Text style={styles.reviseText}>要修正</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => onAction?.('cancel', b)}
            style={[styles.btn, styles.cancel, busy && styles.btnDisabled]}>
            <Text style={styles.cancelText}>キャンセル</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#eef0f3', marginVertical: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '700', color: '#0a1f44' },
  row: { flexDirection: 'row', paddingVertical: 3 },
  label: { width: 72, fontSize: 12, color: '#6b7280' },
  value: { flex: 1, fontSize: 13, color: '#0b0f17' },
  photos: { marginTop: 10 },
  photo: { width: 68, height: 68, borderRadius: 8, marginRight: 8, backgroundColor: '#f3f4f6' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center', borderWidth: 1 },
  btnDisabled: { opacity: 0.5 },
  accept: { backgroundColor: '#059669', borderColor: '#059669' },
  acceptText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  revise: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  reviseText: { color: '#1d4ed8', fontWeight: '700', fontSize: 13 },
  cancel: { backgroundColor: '#fff', borderColor: '#e5e7eb' },
  cancelText: { color: '#b91c1c', fontWeight: '700', fontSize: 13 },
});

/*
Example (admin chat screen):

  const actions = useBookingActions(
    { apiBase: API_BASE, apiKey: API_KEY, adminToken: ADMIN_TOKEN },
    { onChanged: (id, status) => appendSystemMessage(bookingMessage({ ...card, status })) }
  );

  <BookingCard
    booking={{ ...card, status: actions.statusOf(card.id, card.status) }}
    role="admin"
    busy={actions.isPending(card.id)}
    onAction={(action, b) => {
      if (action === 'request_changes') promptNote((note) => actions.requestChanges(b.id, note, b.status));
      else if (action === 'accept')     actions.accept(b.id, undefined, b.status);
      else                              actions.cancel(b.id, undefined, b.status);
    }}
  />
*/
