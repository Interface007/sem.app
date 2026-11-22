import {
  BOOST_DURATION_MS,
  DeviceId,
  LocationBoostList,
  LocationBoostResult,
  LocationList,
  LocationReport,
  LocationReportResult,
  type BoostPushData,
} from '@sem/contracts';
import type { FastifyInstance } from 'fastify';
import { sendError } from '../auth/routes.js';
import type { PushSender } from '../push/fcm.js';
import type { BoostRegistry } from './boosts.js';
import type { LocationStore } from './store.js';

const ROUTE = '/api/locations';
/** A report is a few hundred bytes; anything bigger is not from the app. */
const BODY_LIMIT = 2048;
/** Tolerated clock difference between a phone and the server. */
const MAX_FUTURE_MS = 5 * 60 * 1000;

export interface LocationDeps {
  store: LocationStore;
  boosts: BoostRegistry;
  push: PushSender;
  now: () => number;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Never log coordinates: positions are personal data. */
export function registerLocationRoutes(app: FastifyInstance, deps: LocationDeps): void {
  const { store, boosts, push, now } = deps;

  /** Sends the boost to every device entry with a token; true if at least one was accepted. */
  async function pushBoost(deviceId: string, until: number): Promise<boolean> {
    const data: BoostPushData = { type: 'location-boost', boostUntil: iso(until) };
    const ttlSeconds = Math.max(1, Math.ceil((until - now()) / 1000));
    let pushed = false;
    for (const entry of store.findByDevice(deviceId)) {
      if (entry.pushToken === null) continue;
      const outcome = await push.send(entry.pushToken, data, ttlSeconds);
      if (outcome === 'sent') pushed = true;
      if (outcome === 'invalid_token') {
        store.clearPushToken(entry.user, entry.deviceId, entry.pushToken);
      }
    }
    return pushed;
  }

  app.post(
    ROUTE,
    { preHandler: app.requireSession, bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const parsed = LocationReport.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');
      const report = parsed.data;
      const recordedAt = Date.parse(report.recordedAt);
      if (recordedAt > now() + MAX_FUTURE_MS) return sendError(reply, 400, 'invalid_request');
      // The user always comes from the session, never from the body.
      store.report(request.session.user, report.deviceId, {
        deviceName: report.deviceName,
        latitude: report.latitude,
        longitude: report.longitude,
        accuracy: report.accuracy,
        recordedAt,
        ...(report.pushToken !== undefined && { pushToken: report.pushToken }),
      });
      // Apps that predate boosts send no token field and expect a 204.
      if (report.pushToken === undefined) {
        return reply.code(204).header('Cache-Control', 'no-store').send();
      }
      const until = boosts.get(report.deviceId);
      void reply.header('Cache-Control', 'no-store');
      return LocationReportResult.parse({
        boostUntil: until === undefined ? null : iso(until),
      });
    },
  );

  app.get(ROUTE, { preHandler: app.requireSession }, async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store');
    return LocationList.parse({
      locations: store.list().map((entry) => ({
        user: entry.user,
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        latitude: entry.latitude,
        longitude: entry.longitude,
        accuracy: entry.accuracy,
        recordedAt: new Date(entry.recordedAt).toISOString(),
        receivedAt: new Date(entry.receivedAt).toISOString(),
      })),
    });
  });

  app.get(`${ROUTE}/boosts`, { preHandler: app.requireSession }, async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store');
    return LocationBoostList.parse({
      boosts: boosts.list().map(({ deviceId, until }) => ({ deviceId, boostUntil: iso(until) })),
    });
  });

  // Every signed-in family member may boost every device on the map.
  app.put<{ Params: { deviceId: string } }>(
    `${ROUTE}/:deviceId/boost`,
    { preHandler: app.requireSession },
    async (request, reply) => {
      const deviceId = DeviceId.safeParse(request.params.deviceId);
      if (!deviceId.success) return sendError(reply, 400, 'invalid_request');
      if (store.findByDevice(deviceId.data).length === 0) {
        return sendError(reply, 404, 'not_found');
      }
      const until = now() + BOOST_DURATION_MS;
      boosts.set(deviceId.data, until);
      const pushed = await pushBoost(deviceId.data, until);
      void reply.header('Cache-Control', 'no-store');
      return LocationBoostResult.parse({ boostUntil: iso(until), pushed });
    },
  );

  // Ends the boost; the device learns it with its next report (at most 10 s later).
  app.delete<{ Params: { deviceId: string } }>(
    `${ROUTE}/:deviceId/boost`,
    { preHandler: app.requireSession },
    async (request, reply) => {
      const deviceId = DeviceId.safeParse(request.params.deviceId);
      if (!deviceId.success) return sendError(reply, 400, 'invalid_request');
      boosts.delete(deviceId.data);
      return reply.code(204).header('Cache-Control', 'no-store').send();
    },
  );

  app.delete<{ Params: { deviceId: string } }>(
    `${ROUTE}/:deviceId`,
    { preHandler: app.requireSession },
    async (request, reply) => {
      const deviceId = DeviceId.safeParse(request.params.deviceId);
      if (!deviceId.success) return sendError(reply, 400, 'invalid_request');
      const user = request.session.user;
      if (!store.has(user, deviceId.data) && store.hasOtherUser(user, deviceId.data)) {
        return sendError(reply, 403, 'forbidden');
      }
      store.remove(user, deviceId.data);
      return reply.code(204).header('Cache-Control', 'no-store').send();
    },
  );
}
