import { HausViewerInfo } from '@sem/contracts';

export type ViewerInfoResult =
  { status: 'available'; path: string } | { status: 'not_configured' } | { status: 'unreachable' };

/**
 * Asks the server where the house viewer lives. Network errors, HTTP errors
 * and answers that do not match the contract all count as `unreachable`.
 */
export async function fetchViewerInfo(
  fetcher: (path: string) => Promise<Response>,
): Promise<ViewerInfoResult> {
  try {
    const response = await fetcher('/api/haus/viewer');
    if (!response.ok) return { status: 'unreachable' };
    const info = HausViewerInfo.safeParse(await response.json());
    if (!info.success) return { status: 'unreachable' };
    if (info.data.available) return { status: 'available', path: info.data.path };
    return { status: info.data.reason };
  } catch {
    return { status: 'unreachable' };
  }
}
