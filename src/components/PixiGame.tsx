import * as PIXI from 'pixi.js';
import {
  Container,
  Graphics,
  Text,
  useApp,
} from '@pixi/react';
import { Player, SelectElement } from './Player.tsx';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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

type BuildingKind =
  | 'home'
  | 'farm'
  | 'workshop'
  | 'market'
  | 'warehouse'
  | 'constructionSite';

type BuildingStatus =
  | 'planned'
  | 'constructing'
  | 'active'
  | 'damaged';

type Building = {
  _id: Id<'buildings'>;
  kind: BuildingKind;
  name: string;
  position: {
    x: number;
    y: number;
  };
  status: BuildingStatus;
  capacity: number;
  residents: string[];
  workers: string[];
};

const BUILDING_VISUALS: Record<
  BuildingKind,
  {
    emoji: string;
    label: string;
    width: number;
    height: number;
  }
> = {
  home: {
    emoji: '🏠',
    label: 'Дом',
    width: 3,
    height: 3,
  },

  farm: {
    emoji: '🌾',
    label: 'Ферма',
    width: 4,
    height: 3,
  },

  workshop: {
    emoji: '🔨',
    label: 'Мастерская',
    width: 4,
    height: 3,
  },

  market: {
    emoji
