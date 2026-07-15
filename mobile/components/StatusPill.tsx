// components/StatusPill.tsx — booking status → colored pill.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { BookingStatus } from '../api/bookingStatus';

const STATUS: Record<string, { label: string; fg: string; bg: string; bd: string }> = {
  pending:        { label: 'Pending',        fg: '#b45309', bg: '#fffbeb', bd: '#fde68a' },
  checking:       { label: 'Checking',       fg: '#b45309', bg: '#fffbeb', bd: '#fde68a' },
  confirmed:      { label: 'Confirmed',      fg: '#059669', bg: '#ecfdf5', bd: '#a7f3d0' },
  completed:      { label: 'Completed',      fg: '#0f766e', bg: '#f0fdfa', bd: '#99f6e4' },
  needs_revision: { label: 'Needs Revision', fg: '#1d4ed8', bg: '#eff6ff', bd: '#bfdbfe' },
  cancelled:      { label: 'Cancelled',      fg: '#6b7280', bg: '#f3f4f6', bd: '#e5e7eb' },
  rejected:       { label: 'Rejected',       fg: '#b91c1c', bg: '#fef2f2', bd: '#fecaca' },
};

export function StatusPill({ status }: { status: BookingStatus | string }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <View style={[styles.pill, { backgroundColor: s.bg, borderColor: s.bd }]}>
      <Text style={[styles.text, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  text: { fontSize: 12, fontWeight: '700' },
});
