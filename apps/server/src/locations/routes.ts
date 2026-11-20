import { DeviceId, LocationList, LocationReport } from '@sem/contracts';
import type { FastifyInstance } from 'fastify';
import { sendError } from '../auth/routes.js';
import type { LocationStore } from './store.js';

const ROUTE = '/api/locations';
/** A report is a few hundred bytes; anything bigger is not from the app. */
const BODY_LIMIT = 2048;
/** Tolerated clock difference between a phone and the server. */
const MAX_FUTURE_MS = 5 * 60 * 1000;

export interface LocationDeps {
  store: LocationStore;
  now: () => number;
}

/** Never log coordinates: positions are personal data. */
export function registerLocationRoutes(app: FastifyInstance, deps: LocationDeps): void {
  const { store, now } = deps;

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
      });
      return reply.code(204).header('Cache-Control', 'no-store').send();
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
