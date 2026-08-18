import * as PIXI from 'pixi.js';
import { Graphics, Text, useApp } from '@pixi/react';
import { Player, SelectElement } from './Player.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import PixiViewport from './PixiViewport.tsx';
import { Viewport } from 'pixi-viewport';
import { Id } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api.js';
import { useSendInput } from '../hooks/sendInput.ts';
import { toastOnError } from '../toasts.ts';
import { DebugPath } from './DebugPath.tsx';
import { PositionIndicator } from './PositionIndicator.tsx';
import { SHOW_DEBUG_UI } from './Game.tsx';
import { ServerGame } from '../hooks/serverGame.ts';

type Building = {
  _id: Id<'buildings'>;
  kind:
    | 'home'
    | 'farm'
    | 'workshop'
    | 'market'
    | 'warehouse'
    | 'constructionSite';
  name: string;
  position: {
    x: number;
    y: number;
  };
  capacity: number;
  residents: string[];
  workers: string[];
};

function BuildingMarker({
  building,
  tileDim,
}: {
  building: Building;
  tileDim: number;
}) {
  const x = building.position.x * tileDim;
  const y = building.position.y * tileDim;

  const icons: Record<string, string> = {
    home: '🏠',
    farm: '🌾',
    workshop: '🔨',
    market: '🛒',
    warehouse: '📦',
    constructionSite: '🚧',
  };

  const emoji = icons[building.kind] ?? '🏢';

  const draw = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      g.beginFill(0x3f3f3f, 0.85);
      g.lineStyle(2, 0xffffff, 0.7);

      g.drawRoundedRect(
        x,
        y,
        tileDim * 3,
        tileDim * 2.5,
        6,
      );

      g.endFill();
    },
    [x, y, tileDim],
  );

  const count =
    building.kind === 'home'
      ? building.residents.length
      : building.workers.length;

  return (
    <>
      <Graphics draw={draw} />

      <Text
        text={emoji}
        x={x + tileDim * 1.5}
        y={y + tileDim * 0.8}
        anchor={0.5}
        style={
          new PIXI.TextStyle({
            fontSize: Math.max(18, tileDim),
          })
        }
      />

      <Text
        text={`${building.name} ${count}/${building.capacity}`}
        x={x + tileDim * 1.5}
        y={y + tileDim * 2}
        anchor={0.5}
        style={
          new PIXI.TextStyle({
            fontSize: Math.max(8, tileDim * 0.28),
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 3,
          })
        }
      />
    </>
  );
}

export const PixiGame = (props: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  historicalTime: number | undefined;
  width: number;
  height: number;
  setSelectedElement: SelectElement;
}) => {
  const pixiApp = useApp();
  const viewportRef = useRef<Viewport | undefined>();

  const buildings =
  useQuery(
    (api as any).buildings.listBuildings,
    {
      worldId: props.worldId,
    },
  ) ?? [];

  const humanTokenIdentifier =
    useQuery(
      api.world.userStatus,
      {
        worldId: props.worldId,
      },
    ) ?? null;

  const humanPlayerId = [
    ...props.game.world.players.values(),
  ].find(
    (p) =>
      p.human === humanTokenIdentifier,
  )?.id;

  const moveTo =
    useSendInput(
      props.engineId,
      'moveTo',
    );

  const dragStart =
    useRef<{
      screenX: number;
      screenY: number;
    } | null>(null);

  const onMapPointerDown = (e: any) => {
    dragStart.current = {
      screenX: e.screenX,
      screenY: e.screenY,
    };
  };

  const [
    lastDestination,
    setLastDestination,
  ] = useState<{
    x: number;
    y: number;
    t: number;
  } | null>(null);

  const onMapPointerUp =
    async (e: any) => {
      if (dragStart.current) {
        const dx =
          dragStart.current.screenX -
          e.screenX;

        const dy =
          dragStart.current.screenY -
          e.screenY;

        dragStart.current = null;

        if (
          Math.sqrt(dx * dx + dy * dy) > 10
        ) {
          return;
        }
      }

      if (!humanPlayerId) {
        return;
      }

      const viewport =
        viewportRef.current;

      if (!viewport) {
        return;
      }

      const point =
        viewport.toWorld(
          e.screenX,
          e.screenY,
        );

      const tileDim =
        props.game.worldMap.tileDim;

      const destination = {
        x: Math.floor(
          point.x / tileDim,
        ),

        y: Math.floor(
          point.y / tileDim,
        ),
      };

      setLastDestination({
        ...destination,
        t: Date.now(),
      });

      await toastOnError(
        moveTo({
          playerId: humanPlayerId,
          destination,
        }),
      );
    };

  const {
    width,
    height,
    tileDim,
  } = props.game.worldMap;

  const players = [
    ...props.game.world.players.values(),
  ];

  useEffect(() => {
    if (
      !viewportRef.current ||
      humanPlayerId === undefined
    ) {
      return;
    }

    const humanPlayer =
      props.game.world.players.get(
        humanPlayerId,
      )!;

    viewportRef.current.animate({
      position: new PIXI.Point(
        humanPlayer.position.x * tileDim,
        humanPlayer.position.y * tileDim,
      ),
      scale: 1.5,
    });
  }, [humanPlayerId, tileDim]);

  return (
    <PixiViewport
      app={pixiApp}
      screenWidth={props.width}
      screenHeight={props.height}
      worldWidth={width * tileDim}
      worldHeight={height * tileDim}
      viewportRef={viewportRef}
    >
      <PixiStaticMap
        map={props.game.worldMap}
        onpointerup={onMapPointerUp}
        onpointerdown={onMapPointerDown}
      />

      {buildings.map(
        (building: Building) => (
          <BuildingMarker
            key={building._id}
            building={building}
            tileDim={tileDim}
          />
        ),
      )}

      {players.map(
        (p) =>
          (
            SHOW_DEBUG_UI ||
            p.id === humanPlayerId
          ) && (
            <DebugPath
              key={`path-${p.id}`}
              player={p}
              tileDim={tileDim}
            />
          ),
      )}

      {lastDestination && (
        <PositionIndicator
          destination={lastDestination}
          tileDim={tileDim}
        />
      )}

      {players.map(
        (p) => (
          <Player
            key={`player-${p.id}`}
            game={props.game}
            player={p}
            isViewer={
              p.id === humanPlayerId
            }
            onClick={
              props.setSelectedElement
            }
            historicalTime={
              props.historicalTime
            }
          />
        ),
      )}
    </PixiViewport>
  );
};

export default PixiGame;
