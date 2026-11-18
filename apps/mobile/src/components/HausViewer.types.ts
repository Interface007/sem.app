import type { ViewerEntitiesMessage } from '@sem/contracts';

export interface HausViewerProps {
  /** Absolute (or, on the web, same-origin) address of the viewer. */
  uri: string;
  /** Origin messages must come from. */
  origin: string;
  onEntities: (message: ViewerEntitiesMessage) => void;
  /** Loading failed; the screen switches to "unreachable". */
  onError: () => void;
}
