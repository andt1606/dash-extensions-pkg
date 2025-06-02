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
 * This component follows the proven patterns from reconnecting-websocket.js
 * to provide stable, predictable reconnection behavior.
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
  // Core WebSocket and state management refs
  const wsRef = useRef<WebSocket | null>(null);
  const prevSendRef = useRef<any>();
  
  // Reconnection control variables - these mirror the original library's approach
  const reconnectAttemptsRef = useRef<number>(0);
  const forcedCloseRef = useRef<boolean>(false);
  const timedOutRef = useRef<boolean>(false);
  const isReconnectAttemptRef = useRef<boolean>(false);
  
  // Timeout management
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Internal state management - this acts as our "buffer" like the original library
  const currentReadyStateRef = useRef<number>(WebSocket.CLOSED);

  // Default settings matching the original library exactly
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
   * Creates event data that matches the original library's event structure
   * This ensures compatibility and predictable event handling
   */
  const createEventData = useCallback((type: string, originalEvent?: any, additionalData?: any) => {
    const baseData = {
      type,
      timeStamp: Date.now(),
      isTrusted: originalEvent?.isTrusted || false,
      ...additionalData
    };
    
    // Copy relevant WebSocket event properties
    if (originalEvent) {
      if ('origin' in originalEvent) baseData.origin = originalEvent.origin;
      if ('data' in originalEvent) baseData.data = originalEvent.data;
      if ('code' in originalEvent) baseData.code = originalEvent.code;
      if ('reason' in originalEvent) baseData.reason = originalEvent.reason;
      if ('wasClean' in originalEvent) baseData.wasClean = originalEvent.wasClean;
    }
    
    return baseData;
  }, []);

  /**
   * Safe props setter that only updates when setProps is available
   * This prevents errors during component cleanup
   */
  const safeSetProps = useCallback((props: Record<string, any>) => {
    if (setProps) {
      setProps(props);
    }
  }, [setProps]);

  /**
   * Core connection function that follows the original library's pattern exactly
   * The key improvement here is the reconnectAttempt flag that prevents duplicate events
   */
  const openConnection = useCallback((reconnectAttempt: boolean = false) => {
    if (!url) {
      return;
    }

    // Check reconnection attempt limits - this mirrors the original's logic
    if (reconnectAttempt) {
      if (settings.maxReconnectAttempts && 
          reconnectAttemptsRef.current > settings.maxReconnectAttempts) {
        if (settings.debug) {
          console.debug('ReconnectingWebSocket: Max reconnection attempts reached');
        }
        return;
      }
    } else {
      // This is a fresh connection attempt, dispatch connecting event
      safeSetProps({ 
        connecting: createEventData('connecting'),
        state: { readyState: WebSocket.CONNECTING }
      });
      reconnectAttemptsRef.current = 0;
    }

    // Set our internal state and flags
    isReconnectAttemptRef.current = reconnectAttempt;
    currentReadyStateRef.current = WebSocket.CONNECTING;

    if (settings.debug) {
      console.debug('ReconnectingWebSocket: attempt-connect', url);
    }

    // Create the WebSocket connection
    const ws = new WebSocket(url, protocols || []);
    ws.binaryType = settings.binaryType;
    wsRef.current = ws;

    // Set up connection timeout - this prevents hanging connections
    const connectionTimeout = setTimeout(() => {
      if (settings.debug) {
        console.debug('ReconnectingWebSocket: connection-timeout', url);
      }
      timedOutRef.current = true;
      ws.close();
      timedOutRef.current = false;
    }, settings.timeoutInterval);

    connectionTimeoutRef.current = connectionTimeout;

    // WebSocket event handlers following the original library's pattern

    ws.onopen = (event) => {
      // Clear the connection timeout since we successfully connected
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      if (settings.debug) {
        console.debug('ReconnectingWebSocket: onopen', url);
      }

      // Update our internal state
      currentReadyStateRef.current = WebSocket.OPEN;
      reconnectAttemptsRef.current = 0;

      // Create the open event with reconnection information
      const openEventData = createEventData('open', event, { 
        isReconnect: isReconnectAttemptRef.current 
      });

      safeSetProps({
        state: {
          readyState: WebSocket.OPEN,
          ...openEventData
        }
      });

      // Reset the reconnection flag
      isReconnectAttemptRef.current = false;
    };

    ws.onmessage = (event) => {
      if (settings.debug) {
        console.debug('ReconnectingWebSocket: onmessage', url, event.data);
      }

      safeSetProps({
        message: createEventData('message', event)
      });
    };

    ws.onerror = (event) => {
      if (settings.debug) {
        console.debug('ReconnectingWebSocket: onerror', url, event);
      }

      safeSetProps({
        error: createEventData('error', event)
      });
    };

    // This is the critical onclose handler that implements the original's stable behavior
    ws.onclose = (event) => {
      // Clean up connection timeout
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      // Clear the WebSocket reference
      wsRef.current = null;

      if (settings.debug) {
        console.debug('ReconnectingWebSocket: onclose', url, event.code, event.reason);
      }

      if (forcedCloseRef.current) {
        // This was an intentional close - set final state and stop
        currentReadyStateRef.current = WebSocket.CLOSED;
        safeSetProps({
          state: {
            readyState: WebSocket.CLOSED,
            ...createEventData('close', event)
          }
        });
      } else {
        // This was an unexpected close - handle reconnection
        currentReadyStateRef.current = WebSocket.CONNECTING;
        
        // Create connecting event with close information
        const connectingEvent = createEventData('connecting', event);
        safeSetProps({
          connecting: connectingEvent,
          state: { readyState: WebSocket.CONNECTING }
        });

        // Key improvement: Only dispatch close event if this wasn't a reconnection attempt
        // This prevents the cascade of close events that was causing your mixed error patterns
        if (!isReconnectAttemptRef.current && !timedOutRef.current) {
          if (settings.debug) {
            console.debug('ReconnectingWebSocket: dispatching close event for initial connection loss');
          }
          safeSetProps({
            state: {
              readyState: WebSocket.CONNECTING,
              ...createEventData('close', event)
            }
          });
        }

        // Calculate reconnection delay with exponential backoff
        const delay = Math.min(
          settings.reconnectInterval * Math.pow(settings.reconnectDecay, reconnectAttemptsRef.current),
          settings.maxReconnectInterval
        );

        if (settings.debug) {
          console.debug(`ReconnectingWebSocket: Scheduling reconnection attempt ${reconnectAttemptsRef.current + 1} in ${delay}ms`);
        }

        // Schedule the reconnection attempt
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          openConnection(true);
        }, delay);
      }
    };
  }, [url, protocols, settings, safeSetProps, createEventData]);

  /**
   * Clean disconnection function that properly manages all state
   */
  const disconnect = useCallback(() => {
    // Set forced close flag to prevent reconnection
    forcedCloseRef.current = true;

    // Clear all timeouts
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close WebSocket if it exists
    if (wsRef.current) {
      wsRef.current.close();
    }
  }, []);

  /**
   * Enhanced send function with better connection state handling
   */
  const sendMessage = useCallback(async (message: any) => {
    if (!setProps) return;

    // Check if we have an active connection
    if (currentReadyStateRef.current === WebSocket.OPEN && wsRef.current) {
      try {
        wsRef.current.send(message);
        if (settings.debug) {
          console.debug('ReconnectingWebSocket: Message sent successfully', message);
        }
        return;
      } catch (error) {
        if (settings.debug) {
          console.error('ReconnectingWebSocket: Send failed', error);
        }
      }
    }

    // If we reach here, the connection isn't ready
    if (settings.debug) {
      console.log(`ReconnectingWebSocket: Cannot send message - connection state: ${currentReadyStateRef.current}`);
    }

    // Optionally attempt to reconnect if connection is closed
    if (currentReadyStateRef.current === WebSocket.CLOSED) {
      if (settings.debug) {
        console.log('ReconnectingWebSocket: Attempting to reconnect for message send');
      }
      forcedCloseRef.current = false;
      openConnection(false);
    }
  }, [settings.debug, openConnection, setProps]);

  // Initialize connection when component mounts or URL changes
  useEffect(() => {
    // Don't disconnect existing connections unnecessarily
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && wsRef.current.url === url) {
      return; // Connection is already good, don't recreate it
    }
    
    disconnect(); // Only disconnect if we need a new connection
    // Reset forced close flag for new connections
    forcedCloseRef.current = false;
    
    if (url && settings.automaticOpen) {
      // Add a small delay to prevent rapid reconnection in development
      const initTimeout = setTimeout(() => {
        openConnection(false);
      }, 50);
      
      return () => {
        clearTimeout(initTimeout);
        disconnect();
      };
    }

    return () => {
      disconnect();
    };
  }, [url]);

  // Handle message sending when send prop changes
  useEffect(() => {
    // Only process if send prop actually changed
    if (prevSendRef.current === send) {
      return;
    }
    prevSendRef.current = send;

    if (send !== null && send !== undefined) {
      sendMessage(send);
    }
  }, [send, sendMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return null;
};

export default ReconnectingWebSocket;