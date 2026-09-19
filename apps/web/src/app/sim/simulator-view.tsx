"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function SimulatorView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    async function start() {
      setStatus("requesting");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setStatus("live");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open camera or mic");
        setStatus("error");
      }
    }

    start();

    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full bg-black"
          />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        {status === "requesting" && "Asking for camera and mic access..."}
        {status === "live" && "Camera and mic are live. Frame streaming and push-to-talk aren't wired up yet."}
        {status === "error" && `Camera or mic unavailable: ${error}`}
      </p>
      <Button disabled title="POST /api/ask is not implemented yet">
        Hold to ask
      </Button>
    </div>
  );
}
