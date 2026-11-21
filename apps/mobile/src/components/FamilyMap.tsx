'use dom';

import type { FamilyLocation } from '@sem/contracts';
import { IS_DOM, type DOMProps } from 'expo/dom';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import {
  addMapError,
  boundingBox,
  describeMapError,
  formatAccuracy,
  formatAge,
  isStale,
} from '../lib/family';

export interface FamilyMapProps {
  /** Positions to draw; the map never talks to the server. */
  locations: FamilyLocation[];
  styleUrl: string;
  /** Centers the map on a device; a new `nonce` repeats the request. */
  focus?: { deviceId: string; nonce: number };
  /** Set by Expo for DOM components. */
  dom?: DOMProps;
}

const SINGLE_MARKER_ZOOM = 15;

/**
 * Inside the Android WebView, `html` and `body` have no height, so `100%`
 * resolves to 0 and MapLibre clips everything; fill the viewport there.
 * In the browser the component sits in a sized parent and `100%` works.
 */
const OUTER_STYLE = IS_DOM
  ? ({ position: 'fixed', inset: 0 } as const)
  : ({ position: 'relative', width: '100%', height: '100%' } as const);

interface MarkerEntry {
  marker: maplibregl.Marker;
  element: HTMLElement;
  label: HTMLElement;
  popup: maplibregl.Popup;
}

function popupContent(location: FamilyLocation, now: number): HTMLElement {
  const root = document.createElement('div');
  const lines = [
    location.user,
    location.deviceName,
    formatAge(location.recordedAt, now),
    formatAccuracy(location.accuracy),
  ];
  lines.forEach((text, index) => {
    if (text === undefined) return;
    const line = document.createElement(index === 0 ? 'strong' : 'div');
    line.textContent = text;
    root.append(line);
  });
  return root;
}

function createMarker(): MarkerEntry {
  const element = document.createElement('div');
  element.dataset.testid = 'family-marker';
  element.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer';
  const dot = document.createElement('div');
  dot.style.cssText =
    'width:16px;height:16px;border-radius:50%;background:#1a73e8;border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.6)';
  const label = document.createElement('span');
  label.style.cssText =
    'margin-top:2px;padding:0 4px;font:600 12px sans-serif;background:rgba(255,255,255,.85);border-radius:4px;color:#111';
  element.append(dot, label);
  const popup = new maplibregl.Popup({ offset: 14, closeButton: false });
  const marker = new maplibregl.Marker({ element, anchor: 'top' }).setPopup(popup);
  return { marker, element, label, popup };
}

function fitAll(map: maplibregl.Map, locations: readonly FamilyLocation[], animate: boolean) {
  const box = boundingBox(locations);
  if (box === undefined) return;
  if (locations.length === 1) {
    map.jumpTo({ center: [box.west, box.south], zoom: SINGLE_MARKER_ZOOM });
    return;
  }
  map.fitBounds(
    [
      [box.west, box.south],
      [box.east, box.north],
    ],
    { padding: 60, maxZoom: SINGLE_MARKER_ZOOM, animate },
  );
}

/**
 * Map of the last known positions (MapLibre GL JS, tiles from the style
 * URL). Runs directly in the browser and inside a WebView on Android.
 */
export default function FamilyMap({ locations, styleUrl, focus }: FamilyMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, MarkerEntry>());
  const fitted = useRef(false);
  const latest = useRef(locations);
  latest.current = locations;
  // Shown on the map: on Android there is no other way to see why tiles fail.
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const report = (value: unknown) => {
      const message = describeMapError(value);
      console.warn(`Map error: ${message}`);
      setErrors((list) => addMapError(list, message));
    };
    const onError = (event: ErrorEvent) => report(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    if (container.current === null) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: styleUrl,
      center: [10, 51],
      zoom: 4,
      attributionControl: false,
    });
    // Keeps the source credit of the style visible; never remove it.
    instance.addControl(
      new maplibregl.AttributionControl({
        compact: false,
        customAttribution:
          '<a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a>',
      }),
    );
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('error', (event) => {
      const message = describeMapError(event);
      console.warn(`Map error: ${message}`);
      setErrors((list) => addMapError(list, message));
    });
    map.current = instance;
    const entries = markers.current;
    fitted.current = false;
    return () => {
      for (const entry of entries.values()) entry.marker.remove();
      entries.clear();
      instance.remove();
      map.current = null;
    };
  }, [styleUrl]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    const now = Date.now();
    const entries = markers.current;
    const seen = new Set<string>();
    for (const location of locations) {
      seen.add(location.deviceId);
      let entry = entries.get(location.deviceId);
      if (entry === undefined) {
        entry = createMarker();
        entries.set(location.deviceId, entry);
      }
      const stale = isStale(location.recordedAt, now);
      // The position must be set before the marker is added to the map.
      entry.marker.setLngLat([location.longitude, location.latitude]).addTo(instance);
      entry.element.dataset.stale = String(stale);
      entry.element.dataset.user = location.user;
      entry.element.style.opacity = stale ? '0.45' : '1';
      entry.label.textContent = location.user;
      entry.popup.setDOMContent(popupContent(location, now));
    }
    for (const [deviceId, entry] of entries) {
      if (seen.has(deviceId)) continue;
      entry.marker.remove();
      entries.delete(deviceId);
    }
    // Only the first non-empty set sets the view; later updates just move markers.
    if (!fitted.current && locations.length > 0) {
      fitted.current = true;
      fitAll(instance, locations, false);
    }
  }, [locations, styleUrl]);

  useEffect(() => {
    if (focus === undefined) return;
    const target = latest.current.find((location) => location.deviceId === focus.deviceId);
    if (target === undefined) return;
    map.current?.easeTo({
      center: [target.longitude, target.latitude],
      zoom: Math.max(map.current.getZoom(), SINGLE_MARKER_ZOOM),
    });
  }, [focus]);

  return (
    <div style={OUTER_STYLE}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      <button
        type="button"
        data-testid="family-map-show-all"
        onClick={() => map.current && fitAll(map.current, latest.current, true)}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          padding: '6px 10px',
          font: '600 14px sans-serif',
          background: '#fff',
          border: '1px solid #999',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Alle anzeigen
      </button>
      {errors.length > 0 && (
        <div
          data-testid="family-map-error"
          style={{
            position: 'absolute',
            top: 52,
            left: 10,
            right: 60,
            padding: '6px 8px',
            font: '12px sans-serif',
            color: '#7a0000',
            background: 'rgba(255,235,235,.95)',
            border: '1px solid #d99',
            borderRadius: 6,
            wordBreak: 'break-word',
          }}
        >
          <strong>Kartenfehler</strong>
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      )}
    </div>
  );
}
