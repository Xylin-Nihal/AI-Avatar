import {
  AvatarQuality,
  StreamingEvents,
  VoiceChatTransport,
  VoiceEmotion,
  StartAvatarRequest,
  STTProvider,
  ElevenLabsModel,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn, useUnmount, useUpdate } from "ahooks";

import { Button } from "./Button";
import { AvatarConfig } from "./AvatarConfig";
import { AvatarVideo } from "./AvatarSession/AvatarVideo";
import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { AvatarControls } from "./AvatarSession/AvatarControls";
import { useVoiceChat } from "./logic/useVoiceChat";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { LoadingIcon } from "./Icons";
import { MessageHistory } from "./AvatarSession/MessageHistory";
import { useTextChat } from "./logic/useTextChat";
import { useInterrupt } from "./logic/useInterrupt";

import { AVATARS } from "@/app/lib/constants";

const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  knowledgeId: undefined,
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "en",
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

function splitIntoChunks(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 8) {
    chunks.push(words.slice(i, i + 8).join(" "));
  }
  return chunks;
}

function InteractiveAvatar() {
  const {
    initAvatar,
    startAvatar,
    stopAvatar,
    sessionState,
    stream,
    avatarRef,
  } = useStreamingAvatarSession();
  const { startVoiceChat } = useVoiceChat();
  const { sendMessage, repeatMessage } = useTextChat();
  const { interrupt } = useInterrupt();

  const mediaStream = useRef<HTMLVideoElement>(null);

  const [userContent, setUserContent] = useState("");
  const [chunks, setChunks] = useState<string[]>([]);
  const chunkIndexRef = useRef(0);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInterrupted, setIsInterrupted] = useState(false);
  const [resumeRequested, setResumeRequested] = useState(false);

  const update = useUpdate();

  const speakRemainingChunks = async () => {
    while (chunkIndexRef.current < chunks.length) {
      if (isInterrupted && !resumeRequested) break;
      const chunk = chunks[chunkIndexRef.current];
      setIsSpeaking(true);
      await repeatMessage(chunk);
      setIsSpeaking(false);
      chunkIndexRef.current++;
      update();
      await new Promise((res) => setTimeout(res, 1000));
    }
    setResumeRequested(false);
  };

  const startSessionV2 = useMemoizedFn(async (isVoiceChat: boolean) => {
    try {
      const response = await fetch("/api/get-access-token", { method: "POST" });
      const token = await response.text();
      if (!token) throw new Error("No access token");

      const avatar = initAvatar(token);

      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
        setIsSpeaking(true);
      });

      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
        setIsSpeaking(false);
      });

      await startAvatar(DEFAULT_CONFIG);
      if (isVoiceChat) await startVoiceChat();
    } catch (error) {
      console.error("Error starting avatar session:", error);
    }
  });

  useUnmount(() => {
    stopAvatar();
  });

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current?.play();
      };
    }
  }, [stream]);

  const startSpeaking = useMemoizedFn(() => {
    if (!chunks.length || isSpeaking) return;
    setIsInterrupted(false);
    setResumeRequested(false);
    chunkIndexRef.current = 0;
    speakRemainingChunks();
  });

  const handleInterrupt = useMemoizedFn((userInput: string) => {
    if (!isSpeaking) return;
    setIsInterrupted(true);
    setResumeRequested(false);
    interrupt();
    sendMessage(userInput);
  });

  const resumeSpeaking = useMemoizedFn(() => {
    if (!isInterrupted || isSpeaking || chunkIndexRef.current >= chunks.length) return;
    setResumeRequested(true);
    setIsInterrupted(false);
    speakRemainingChunks();
  });

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="mb-2 flex flex-row gap-2">
        <input
          className="flex-1 p-2 rounded bg-zinc-800 text-white"
          type="text"
          placeholder="Enter content for avatar to speak..."
          value={userContent}
          onChange={(e) => {
            const input = e.target.value;
            setUserContent(input);
            const sentenceChunks = splitIntoChunks(input);
            setChunks(sentenceChunks);
            chunkIndexRef.current = 0;
            setIsInterrupted(false);
            setResumeRequested(false);
          }}
        />
        <Button onClick={startSpeaking} disabled={!userContent || isSpeaking}>
          Speak
        </Button>
        <Button
          onClick={() => handleInterrupt("User interruption!")}
          disabled={!isSpeaking}
        >
          Interrupt
        </Button>
        <Button onClick={resumeSpeaking} disabled={!isInterrupted || isSpeaking}>
          Resume
        </Button>
      </div>

      <div className="flex flex-col rounded-xl bg-zinc-900 overflow-hidden">
        <div className="relative w-full aspect-video overflow-hidden flex flex-col items-center justify-center">
          {sessionState !== StreamingAvatarSessionState.INACTIVE ? (
            <AvatarVideo ref={mediaStream} />
          ) : (
            <AvatarConfig config={DEFAULT_CONFIG} onConfigChange={() => {}} />
          )}
        </div>

        <div className="flex flex-col gap-3 items-center justify-center p-4 border-t border-zinc-700 w-full">
          {sessionState === StreamingAvatarSessionState.CONNECTED ? (
            <AvatarControls />
          ) : sessionState === StreamingAvatarSessionState.INACTIVE ? (
            <div className="flex flex-row gap-4">
              <Button onClick={() => startSessionV2(true)}>Start Voice Chat</Button>
              <Button onClick={() => startSessionV2(false)}>Start Text Chat</Button>
            </div>
          ) : (
            <LoadingIcon />
          )}
        </div>
      </div>
      {sessionState === StreamingAvatarSessionState.CONNECTED && <MessageHistory />}
    </div>
  );
}

export default function InteractiveAvatarWrapper() {
  return (
    <StreamingAvatarProvider basePath={process.env.NEXT_PUBLIC_BASE_API_URL}>
      <InteractiveAvatar />
    </StreamingAvatarProvider>
  );
}