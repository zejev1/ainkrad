import { Component, ReactNode, useEffect, useRef, useState } from 'react';
import PixiGame from './PixiGame.tsx';

import { useElementSize } from 'usehooks-ts';
import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useMutation, useQuery } from 'convex/react';
import PlayerDetails from './PlayerDetails.tsx';
import { api } from '../../convex/_generated/api';
import { useWorldHeartbeat } from '../hooks/useWorldHeartbeat.ts';
import { useHistoricalTime } from '../hooks/useHistoricalTime.ts';
import { DebugTimeManager } from './DebugTimeManager.tsx';
import { GameId } from '../../convex/aiTown/ids.ts';
import { useServerGame } from '../hooks/serverGame.ts';

export const SHOW_DEBUG_UI = !!import.meta.env.VITE_SHOW_DEBUG_UI;

class NpcPanelErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: null,
    };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('NPC panel crashed', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-white bg-black/70 font-mono text-sm">
          <div className="text-xl mb-2">NPC panel error</div>

          <div className="text-red-400 break-words">
            {this.state.message ?? 'Unknown error'}
          </div>

          <div className="mt-3 text-gray-300">
            The town is still running. Reload the page to reset this panel.
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function Game() {
  const convex = useConvex();

  const [selectedElement, setSelectedElement] = useState<{
    kind: 'player';
    id: GameId<'players'>;
  }>();

  const [gameWrapperRef, { width, height }] = useElementSize();

  const safeWidth = Math.max(width || 0, 320);
  const safeHeight = Math.max(height || 0, 240);

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const initWorld = useMutation(api.init.default);
  const seedSettlement = useMutation(
  (api as any).seedSettlement.seedDefaultSettlement,
);

  const [initStarted, setInitStarted] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;

  const game = useServerGame(worldId);

  useEffect(() => {
    if (worldStatus !== null || initStarted) {
      return;
    }

    setInitStarted(true);

    initWorld({})
      .then(() => {
        console.log('Ainkrad world initialized');
      })
      .catch((error) => {
        console.error('Failed to initialize Ainkrad world', error);
        setInitError(error instanceof Error ? error.message : String(error));
      });
  }, [worldStatus, initStarted, initWorld]);

  useWorldHeartbeat();

  const worldState = useQuery(
    api.world.worldState,
    worldId ? { worldId } : 'skip',
  );

  const { historicalTime, timeManager } = useHistoricalTime(
    worldState?.engine,
  );

  const scrollViewRef = useRef<HTMLDivElement>(null);

  if (!worldId || !engineId || !game) {
    return (
      <div className="mx-auto my-6 w-full max-w-2xl bg-black/70 text-white p-4 font-mono text-sm">
        <div className="text-xl mb-3">Connecting to Ainkrad...</div>

        <div>World: {worldId ? '✓' : '…'}</div>
        <div>Engine: {engineId ? '✓' : '…'}</div>
        <div>Game: {game ? '✓' : '…'}</div>

        {worldStatus === undefined && (
          <div className="mt-3 text-yellow-300">
            Checking Convex...
          </div>
        )}

        {worldStatus === null && !initError && (
          <div className="mt-3 text-yellow-300">
            Creating world and NPCs...
          </div>
        )}

        {initError && (
          <div className="mt-3 text-red-400">
            Init error: {initError}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {SHOW_DEBUG_UI && (
        <DebugTimeManager
          timeManager={timeManager}
          width={200}
          height={100}
        />
      )}

      <div className="mx-auto w-full max-w grid grid-rows-[240px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:grow max-w-[1400px] min-h-[480px] game-frame">
        <div
          className="relative overflow-hidden bg-brown-900 min-h-[240px]"
          ref={gameWrapperRef}
        >
          <div className="absolute inset-0">
            <div className="container">
              <Stage
                width={safeWidth}
                height={safeHeight}
                options={{
                  backgroundColor: 0x7ab5ff,
                  antialias: false,
                  autoDensity: true,
                }}
              >
                <ConvexProvider client={convex}>
                  <PixiGame
                    game={game}
                    worldId={worldId}
                    engineId={engineId}
                    width={safeWidth}
                    height={safeHeight}
                    historicalTime={historicalTime}
                    setSelectedElement={setSelectedElement}
                  />
                </ConvexProvider>
              </Stage>
            </div>
          </div>
        </div>

        <div
          className="flex flex-col overflow-y-auto shrink-0 px-4 py-6 sm:px-6 lg:w-96 xl:pr-6 border-t-8 sm:border-t-0 sm:border-l-8 border-brown-900 bg-brown-800 text-brown-100"
          ref={scrollViewRef}
        >
          <NpcPanelErrorBoundary>
            <PlayerDetails
              worldId={worldId}
              engineId={engineId}
              game={game}
              playerId={selectedElement?.id}
              setSelectedElement={setSelectedElement}
              scrollViewRef={scrollViewRef}
            />
          </NpcPanelErrorBoundary>
        </div>
      </div>
    </>
  );
}
