import { useEffect, useRef } from 'react';
import { getSocket, getBoardSocket } from '../utils/socket';

const DEBOUNCE_MS = 300;

// Subscribes to one or more socket.io events on either the authenticated
// staff channel or the public board channel, and calls `handler` with the
// event payload — collapsing rapid-fire events within DEBOUNCE_MS into a
// single call so a burst of updates doesn't trigger a reload storm.
//
// `handler` is stashed in a ref so callers don't need to useCallback it and
// so the subscription effect doesn't re-run just because the handler
// closure changed identity on re-render.
export default function useRealtimeEvent(events, handler, { channel = 'staff', enabled = true } = {}) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const eventList = Array.isArray(events) ? events : [events];
  const eventsKey = eventList.join('|');

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = channel === 'board' ? getBoardSocket() : getSocket();

    let timer = null;
    let lastPayload;
    const flush = () => {
      timer = null;
      handlerRef.current?.(lastPayload);
    };
    const onEvent = (payload) => {
      lastPayload = payload;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    };

    eventList.forEach((evt) => socket.on(evt, onEvent));

    return () => {
      if (timer) clearTimeout(timer);
      eventList.forEach((evt) => socket.off(evt, onEvent));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey, channel, enabled]);
}
