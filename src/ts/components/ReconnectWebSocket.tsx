import React, { useEffect, useRef, useCallback } from 'react';

export type ReconnectingWebSocketOptions = {
  /** Whether this instance should log debug messages */
  debug?: boolean;
  /** Whether or not the websocket should attempt to connect immediately upon instantiation */
  automaticOpen?: boolean;
  /** The number of milliseconds to delay before attempting to reconnect */
  reconnectInterval?: number;
  /** The maximum number of milliseconds to delay a reconnection attempt */
  maxReconnectInterval?: number;
  /** The rate of increase of the reconnect delay. Allows reconnect attempts to back off when problems persist */
  reconnectDecay?: number;
  /** The maximum time in milliseconds to wait for a connection to succeed before closing and retrying */
  timeoutInterval?: number;
  /** The maximum number of reconnection attempts to make. Unlimited if null */
  maxReconnectAttempts?: number | null;
  /** The binary type, possible values 'blob' or 'arraybuffer' */
  binaryType?: 'blob' | 'arraybuffer';
};

export interface ReconnectingWebSocketProps {
  /**
   * The ID used to identify this component in Dash callbacks.
   */
  id?: string;
  
  /**
   * This websocket state (in the readyState prop) and associated information.
   */
  state?: any;
  
  /**
   * When messages are received, this property is updated with the message content.
   */
  message?: any;
  
  /**
   * This property is set with the content of the onerror event.
   */
  error?: any;
  
  /**
   * This property is set with the content of connecting events.
   */
  connecting?: any;
  
  /**
   * When this property is set, a message is sent with its content.
   */
  send?: any;
  
  /**
   * The websocket endpoint (e.g. wss://echo.websocket.org).
   */
  url?: string;
  
  /**
   * Supported websocket protocols (optional).
   */
  protocols?: string[];
  
  /**
   * How many ms to wait for websocket to be ready when sending a message (optional).
   */
  timeout?: number;
  
  /**
   * Reconnection options to configure auto-reconnect behavior.
   */
  reconnectOptions?: ReconnectingWebSocketOptions;

  /**
   * Dash-assigned callback that updates properties on the backend.
   */
  setProps?: (props: Record<string, any>) => void;
}

/**
 * A WebSocket interface with automatic reconnection capabilities.
 * This component combines the Dash-compatible interface with robust reconnection logic.
 * 
 * Example usage:
 * ```python
 * import dash_extensions_demo as ded
 * 
 * app.layout = html.Div([
 *     ded.ReconnectingWebSocket(
 *         id="ws",
 *         url="wss://echo.websocket.org",
 *         reconnectOptions={
 *             "debug": True,
 *             "reconnectInterval": 1000,
 *             "maxReconnectAttempts": 5
 *         }
 *     )
 * ])
 * ```
 */
const ReconnectingWebSocket: React.FC<ReconnectingWebSocketProps> = ({
  id,
  url,
  protocols,
  timeout = 1000,
  send,
  setProps,
  reconnectOptions = {},
  state = { readyState: WebSocket.CLOSED },
}) => {
  // Refs to maintain WebSocket instance and internal state
  const wsRef = useRef<WebSocket | null>(null);
  const prevSendRef = useRef<any>();
  const reconnectAttemptsRef = useRef<number>(0);
  const forcedCloseRef = useRef<boolean>(false);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Default reconnection settings - matching the original library defaults
  const settings: Required<ReconnectingWebSocketOptions> = {
    debug: false,
    automaticOpen: true,
    reconnectInterval: 1000,
    maxReconnectInterval: 30000,
    reconnectDecay: 1.5,
    timeoutInterval: 2000,
    maxReconnectAttempts: null,
    binaryType: 'blob',
    ...reconnectOptions
  };

  /**
   * Utility function to create event data compatible with original WebSocket events
   * This ensures that the data structure matches what developers expect from standard WebSocket events
   */
  const createEventData = useCallback((type: string, originalEvent?: any, additionalData?: any) => {
    const baseData = {
      type,
      timeStamp: Date.now(),
      isTrusted: originalEvent?.isTrusted || false,
      ...additionalData
    };
    
    if (originalEvent) {
      // Copy relevant properties from original event
      if ('origin' in originalEvent) baseData.origin = originalEvent.origin;
      if ('data' in originalEvent) baseData.data = originalEvent.data;
      if ('code' in originalEvent) baseData.code = originalEvent.code;
      if ('reason' in originalEvent) baseData.reason = originalEvent.reason;
      if ('wasClean' in originalEvent) baseData.wasClean = originalEvent.wasClean;
    }
    
    return baseData;
  }, []);

  /**
   * Main function to establish WebSocket connection with reconnection logic
   * This is the heart of our reconnection system - it handles both initial connections
   * and reconnection attempts with exponential backoff
   */
  const connect = useCallback((isReconnectAttempt: boolean = false) => {
    if (!url || !setProps) {
      return;
    }

    // Check if we've exceeded max reconnection attempts
    if (isReconnectAttempt && settings.maxReconnectAttempts && 
        reconnectAttemptsRef.current > settings.maxReconnectAttempts) {
      if (settings.debug) {
        console.debug('ReconnectingWebSocket: Max reconnection attempts reached');
      }
      return;
    }

    // Create new WebSocket instance
    const ws = new WebSocket(url, protocols || []);
    ws.binaryType = settings.binaryType;
    wsRef.current = ws;

    // Set initial connecting state
    if (!isReconnectAttempt) {
      reconnectAttemptsRef.current = 0;
      setProps({ 
        connecting: createEventData('connecting'),
        state: { readyState: WebSocket.CONNECTING }
      });
    }

    if (settings.debug) {
      console.debug('ReconnectingWebSocket: attempt-connect', url);
    }

    // Set up connection timeout - this prevents hanging connections
    const connectionTimeout = setTimeout(() => {
      if (settings.debug) {
        console.debug('ReconnectingWebSocket: connection-timeout', url);
      }
      ws.close();
    }, settings.timeoutInterval);

    timeoutIdRef.current = connectionTimeout;

    // WebSocket event handlers
    ws.onopen = (event) => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }

      if (settings.debug) {
        console.debug('ReconnectingWebSocket: onopen', url);
      }

      // Reset reconnection attempts on successful connection
      reconnectAttemptsRef.current = 0;

      setProps({
        state: {
          readyState: WebSocket.OPEN,
          ...createEventData('open', event, { isReconnect: isReconnectAttempt })
        }
      });
    };

    ws.onmessage = (event) => {
      if (settings.debug) {
        console.debug('ReconnectingWebSocket: onmessage', url, event.data);
      }

      setProps({
        message: createEventData('message', event)
      });
    };

    ws.onerror = (event) => {
      if (settings.debug) {
        console.debug('ReconnectingWebSocket: onerror', url, event);
      }

      setProps({
        error: createEventData('error', event)
      });
    };

    ws.onclose = (event) => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }

      wsRef.current = null;

      if (forcedCloseRef.current) {
        // Connection was intentionally closed
        setProps({
          state: {
            readyState: WebSocket.CLOSED,
            ...createEventData('close', event)
          }
        });
      } else {
        // Connection lost - attempt to reconnect
        if (settings.debug) {
          console.debug('ReconnectingWebSocket: onclose', url);
        }

        setProps({
          connecting: createEventData('connecting', event),
          state: { readyState: WebSocket.CONNECTING }
        });

        // Calculate reconnection delay with exponential backoff
        // This is crucial for not overwhelming the server with connection attempts
        const delay = Math.min(
          settings.reconnectInterval * Math.pow(settings.reconnectDecay, reconnectAttemptsRef.current),
          settings.maxReconnectInterval
        );

        if (settings.debug) {
          console.debug(`ReconnectingWebSocket: Scheduling reconnection in ${delay}ms`);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connect(true);
        }, delay);
      }
    };
  }, [url, protocols, settings, setProps, createEventData]);

  /**
   * Clean up WebSocket connection and clear timeouts
   * This is essential for preventing memory leaks
   */
  const disconnect = useCallback(() => {
    // Clear any pending timeouts
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close WebSocket connection
    if (wsRef.current) {
      forcedCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  /**
   * Send message through WebSocket with connection state handling
   * This function is intelligent - it will attempt to reconnect if needed
   */
  const sendMessage = useCallback(async (message: any) => {
    if (!setProps) return;

    // If connection is closed, attempt to reconnect
    if (state.readyState === WebSocket.CLOSED) {
      if (settings.debug) {
        console.log('ReconnectingWebSocket: Connection CLOSED. Attempting to reconnect...');
      }
      forcedCloseRef.current = false;
      connect(false);
      // Wait briefly for connection attempt
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // If connection is still connecting, wait for timeout period
    if (state.readyState === WebSocket.CONNECTING) {
      if (settings.debug) {
        console.log('ReconnectingWebSocket: Connection CONNECTING. Waiting...');
      }
      await new Promise(resolve => setTimeout(resolve, timeout));
    }

    // Send message if connection is open
    if (state.readyState === WebSocket.OPEN && wsRef.current) {
      try {
        wsRef.current.send(message);
        if (settings.debug) {
          console.debug('ReconnectingWebSocket: Message sent', message);
        }
      } catch (error) {
        if (settings.debug) {
          console.error('ReconnectingWebSocket: Send failed', error);
        }
      }
    } else {
      if (settings.debug) {
        console.log('ReconnectingWebSocket: Unable to send message - connection not ready');
      }
    }
  }, [state.readyState, timeout, settings.debug, connect, setProps]);

  // Initialize connection when URL changes
  useEffect(() => {
    disconnect(); // Clean up any existing connection
    forcedCloseRef.current = false;
    
    if (url && settings.automaticOpen) {
      connect(false);
    }

    // Cleanup function - this runs when component unmounts or dependencies change
    return () => {
      disconnect();
    };
  }, [url, protocols, connect, disconnect, settings.automaticOpen]);

  // Handle sending messages when 'send' prop changes
  useEffect(() => {
    // Only send if the send prop has actually changed
    // This prevents unnecessary message sends on every render
    if (prevSendRef.current === send) {
      return;
    }
    prevSendRef.current = send;

    if (send !== null && send !== undefined) {
      sendMessage(send);
    }
  }, [send, sendMessage]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // This component doesn't render anything - it's purely for WebSocket management
  // This is common for utility components in Dash
  return null;
};

export default ReconnectingWebSocket;