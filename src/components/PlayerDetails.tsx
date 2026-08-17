import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { SelectElement } from './Player';
import { Messages } from './Messages';
import { toastOnError } from '../toasts';
import { useSendInput } from '../hooks/sendInput';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';

export default function PlayerDetails({
  worldId,
  engineId,
  game,
  playerId,
  setSelectedElement,
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  playerId?: GameId<'players'>;
  setSelectedElement: SelectElement;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId });

  const [waitingForTurn, setWaitingForTurn] = useState(false);

  const players = [...game.world.players.values()];
  const humanPlayer = players.find(
    (p) => p.human === humanTokenIdentifier,
  );

  const humanConversation = humanPlayer
    ? game.world.playerConversation(humanPlayer)
    : undefined;

  // Если человек уже разговаривает, показываем собеседника.
  if (humanPlayer && humanConversation) {
    const otherPlayerIds = [...humanConversation.participants.keys()].filter(
      (p) => p !== humanPlayer.id,
    );

    if (otherPlayerIds.length > 0) {
      playerId = otherPlayerIds[0];
    }
  }

  const player =
    playerId !== undefined
      ? game.world.players.get(playerId)
      : undefined;

  const playerConversation = player
    ? game.world.playerConversation(player)
    : undefined;

  const previousConversation = useQuery(
    api.world.previousConversation,
    playerId ? { worldId, playerId } : 'skip',
  );

  const playerDescription =
    playerId !== undefined
      ? game.playerDescriptions.get(playerId)
      : undefined;

  const startConversation = useSendInput(
    engineId,
    'startConversation',
  );

  const acceptInvite = useSendInput(
    engineId,
    'acceptInvite',
  );

  const rejectInvite = useSendInput(
    engineId,
    'rejectInvite',
  );

  const leaveConversation = useSendInput(
    engineId,
    'leaveConversation',
  );

  // Если мы "позвали после разговора", ждём,
  // пока выбранный NPC освободится.
  useEffect(() => {
    if (
      !waitingForTurn ||
      !humanPlayer ||
      !playerId
    ) {
      return;
    }

    // Если человек уже сам оказался в разговоре,
    // очередь не запускаем.
    if (humanConversation) {
      return;
    }

    const targetPlayer = game.world.players.get(playerId);

    if (!targetPlayer) {
      setWaitingForTurn(false);
      return;
    }

    const targetConversation =
      game.world.playerConversation(targetPlayer);

    // NPC пока занят.
    if (targetConversation) {
      return;
    }

    // NPC освободился — отправляем обычное приглашение.
    setWaitingForTurn(false);

    void toastOnError(
      startConversation({
        playerId: humanPlayer.id,
        invitee: playerId,
      }),
    );
  }, [
    waitingForTurn,
    humanPlayer,
    humanConversation,
    playerId,
    game,
    startConversation,
  ]);

  if (!playerId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        Нажмите на жителя на карте, чтобы посмотреть информацию и историю разговоров.
      </div>
    );
  }

  if (!player) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        Этот житель сейчас недоступен.
      </div>
    );
  }

  const isMe =
    !!humanPlayer &&
    player.id === humanPlayer.id;

  const sameConversation =
    !isMe &&
    !!humanPlayer &&
    !!humanConversation &&
    !!playerConversation &&
    humanConversation.id === playerConversation.id;

  const humanStatus =
    humanPlayer &&
    humanConversation?.participants.get(humanPlayer.id)?.status;

  const playerStatus =
    playerConversation?.participants.get(playerId)?.status;

  const haveInvite =
    sameConversation &&
    humanStatus?.kind === 'invited';

  const waitingForAccept =
    sameConversation &&
    playerStatus?.kind === 'invited';

  const waitingForNearby =
    sameConversation &&
    playerStatus?.kind === 'walkingOver' &&
    humanStatus?.kind === 'walkingOver';

  const inConversationWithMe =
    sameConversation &&
    playerStatus?.kind === 'participating' &&
    humanStatus?.kind === 'participating';

  const canTalkNow =
    !isMe &&
    !!humanPlayer &&
    !humanConversation &&
    !playerConversation;

  const canWaitForNpc =
    !isMe &&
    !!humanPlayer &&
    !humanConversation &&
    !!playerConversation;

  const onStartConversation = async () => {
    if (!humanPlayer || !playerId) {
      return;
    }

    console.log('Обращение к NPC');

    await toastOnError(
      startConversation({
        playerId: humanPlayer.id,
        invitee: playerId,
      }),
    );
  };

  const onWaitForNpc = () => {
    setWaitingForTurn(true);
  };

  const onCancelWaiting = () => {
    setWaitingForTurn(false);
  };

  const onAcceptInvite = async () => {
    if (
      !humanPlayer ||
      !humanConversation ||
      !playerId
    ) {
      return;
    }

    await toastOnError(
      acceptInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };

  const onRejectInvite = async () => {
    if (
      !humanPlayer ||
      !humanConversation
    ) {
      return;
    }

    await toastOnError(
      rejectInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };

  const onLeaveConversation = async () => {
    if (
      !humanPlayer ||
      !inConversationWithMe ||
      !humanConversation
    ) {
      return;
    }

    await toastOnError(
      leaveConversation({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };

  return (
    <>
      <div className="flex gap-4">
        <div className="box w-3/4 sm:w-full mr-auto">
          <h2 className="bg-brown-700 p-2 font-display text-2xl sm:text-4xl tracking-wider shadow-solid text-center">
            {playerDescription?.name ?? 'Неизвестный житель'}
          </h2>
        </div>

        <a
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          onClick={() => {
            setWaitingForTurn(false);
            setSelectedElement(undefined);
          }}
        >
          <h2 className="h-full bg-clay-700">
            <img
              className="w-4 h-4 sm:w-5 sm:h-5"
              src={closeImg}
              alt="Закрыть"
            />
          </h2>
        </a>
      </div>

      {!humanPlayer && !isMe && (
        <div className="box flex-grow mt-6">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center p-2">
            Чтобы взаимодействовать с жителями, сначала нажмите «Войти в мир».
          </h2>
        </div>
      )}

      {canTalkNow && !waitingForTurn && (
        <a
          className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
          onClick={onStartConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>Обратиться</span>
          </div>
        </a>
      )}

      {canWaitForNpc && !waitingForTurn && (
        <>
          <a
            className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={onWaitForNpc}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Позвать после разговора</span>
            </div>
          </a>

          <div className="box flex-grow mt-3">
            <h2 className="bg-brown-700 text-sm sm:text-base text-center p-2">
              Сейчас этот житель занят разговором. Мы не будем прерывать его беседу.
            </h2>
          </div>
        </>
      )}

      {waitingForTurn && (
        <>
          <div className="box flex-grow mt-6">
            <h2 className="bg-brown-700 text-base sm:text-lg text-center p-2">
              Ждём, пока {playerDescription?.name ?? 'житель'} освободится…
            </h2>
          </div>

          <a
            className="mt-3 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={onCancelWaiting}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Отменить ожидание</span>
            </div>
          </a>
        </>
      )}

      {!!humanConversation &&
        !sameConversation &&
        !isMe && (
          <div className="box flex-grow mt-6">
            <h2 className="bg-brown-700 text-base sm:text-lg text-center p-2">
              Сначала завершите свой текущий разговор.
            </h2>
          </div>
        )}

      {waitingForAccept && (
        <div className="mt-6 button text-white shadow-solid text-xl opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>Ждём ответа…</span>
          </div>
        </div>
      )}

      {waitingForNearby && (
        <div className="mt-6 button text-white shadow-solid text-xl opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>Подходим друг к другу…</span>
          </div>
        </div>
      )}

      {inConversationWithMe && (
        <a
          className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
          onClick={onLeaveConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>Завершить разговор</span>
          </div>
        </a>
      )}

      {haveInvite && (
        <>
          <a
            className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={onAcceptInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Принять приглашение</span>
            </div>
          </a>

          <a
            className="mt-3 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={onRejectInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Отказаться</span>
            </div>
          </a>
        </>
      )}

      {!playerConversation &&
        player.activity &&
        player.activity.until > Date.now() && (
          <div className="box flex-grow mt-6">
            <h2 className="bg-brown-700 text-base sm:text-lg text-center">
              {player.activity.description}
            </h2>
          </div>
        )}

      <div className="desc my-6">
        <p className="leading-tight -m-4 bg-brown-700 text-base sm:text-sm">
          {!isMe && playerDescription?.description}

          {isMe && (
            <i>Это ваш персонаж.</i>
          )}

          {!isMe && inConversationWithMe && (
            <>
              <br />
              <br />
              <i>Сейчас разговаривает с вами.</i>
            </>
          )}
        </p>
      </div>

      {!isMe &&
        playerConversation &&
        playerStatus?.kind === 'participating' && (
          <Messages
            worldId={worldId}
            engineId={engineId}
            inConversationWithMe={
              inConversationWithMe ?? false
            }
            conversation={{
              kind: 'active',
              doc: playerConversation,
            }}
            humanPlayer={humanPlayer}
            scrollViewRef={scrollViewRef}
          />
        )}

      {!playerConversation &&
        previousConversation && (
          <>
            <div className="box flex-grow">
              <h2 className="bg-brown-700 text-lg text-center">
                Предыдущий разговор
              </h2>
            </div>

            <Messages
              worldId={worldId}
              engineId={engineId}
              inConversationWithMe={false}
              conversation={{
                kind: 'archived',
                doc: previousConversation,
              }}
              humanPlayer={humanPlayer}
              scrollViewRef={scrollViewRef}
            />
          </>
        )}
    </>
  );
}
