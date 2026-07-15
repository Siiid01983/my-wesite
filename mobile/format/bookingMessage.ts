// format/bookingMessage.ts — JP customer-notification formatter.
//
// Mirrors the server message built by booking-status.php so the in-app chat
// message matches the inbox_messages notification the customer receives.
import type { BookingStatus } from '../api/bookingStatus';

export type BookingMessageInput = {
  ref: string;       // HM-… reference (or booking id)
  name: string;
  fromAddr: string;
  toAddr?: string;
  date: string;      // YYYY-MM-DD
  time?: string;
  status: BookingStatus | string;
  note?: string;     // revision note / cancellation reason
};

const HEAD: Record<string, string> = {
  confirmed:      '✅ ご予約が確定しました',
  cancelled:      '❌ ご予約がキャンセルされました',
  needs_revision: '✏️ ご予約内容のご確認をお願いします',
  pending:        '🕒 ご予約を確認中です',
};

export function bookingMessage(b: BookingMessageInput): string {
  const route = b.toAddr ? `${b.fromAddr} → ${b.toAddr}` : b.fromAddr;
  const head = HEAD[b.status] ?? 'ご予約の状態が更新されました';
  const noteLine = b.note
    ? (b.status === 'needs_revision' ? `修正のお願い: ${b.note}` : `備考: ${b.note}`)
    : '';

  return [
    head,
    '',
    `予約番号: ${b.ref}`,
    `お名前: ${b.name} 様`,
    `ルート: ${route}`,
    `日程: ${b.date}`,
    b.time ? `時間: ${b.time}` : '',
    noteLine,
  ].filter(Boolean).join('\n');
}
