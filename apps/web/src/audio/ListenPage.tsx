import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { get } from "../api/client";
import type { AudioRecording } from "../api/types";
import { Busy, ErrorBox, Page, Button, Row, icons } from "../ui";
import { usePlayer } from "./PlayerProvider";

/**
 * A direct link to a recording. It opens the shared player full screen and leaves you on the book's page, so closing or
 * minimizing the player returns you to the app rather than to a blank screen.
 */
export function ListenPage() {
  const { recordingId = "" } = useParams();
  const player = usePlayer();
  const rec = useQuery({ queryKey: ["listen-link", recordingId], queryFn: () => get<AudioRecording>(`/recordings/${recordingId}`), staleTime: 60_000 });
  useEffect(() => { if (rec.data) player.start(recordingId, { autoplay: false, expand: true }); }, [rec.data, recordingId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (rec.isPending) return <Busy />;
  if (rec.error) return <Page><ErrorBox error={rec.error} /><Row><Button to="/" icon={icons.arrowLeft}>Back to library</Button></Row></Page>;
  return <Navigate to={`/titles/${rec.data!.titleId}`} replace />;
}
