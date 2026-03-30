"use server";

import { supabase } from "@/lib/supabase";
import { Overlay } from "@/lib/types";

export async function getOverlays(projectId: string): Promise<Overlay[]> {
  const { data, error } = await supabase
    .from("overlays")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createOverlay(input: {
  project_id: string;
  name: string;
  image_url: string;
  opacity: number;
  top_left_lng: number;
  top_left_lat: number;
  top_right_lng: number;
  top_right_lat: number;
  bottom_right_lng: number;
  bottom_right_lat: number;
  bottom_left_lng: number;
  bottom_left_lat: number;
}): Promise<Overlay> {
  const { data, error } = await supabase
    .from("overlays")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateOverlay(
  id: string,
  input: {
    opacity?: number;
    top_left_lng?: number;
    top_left_lat?: number;
    top_right_lng?: number;
    top_right_lat?: number;
    bottom_right_lng?: number;
    bottom_right_lat?: number;
    bottom_left_lng?: number;
    bottom_left_lat?: number;
  }
): Promise<Overlay> {
  const { data, error } = await supabase
    .from("overlays")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteOverlay(id: string): Promise<void> {
  const { error } = await supabase.from("overlays").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function uploadOverlayImage(
  formData: FormData
): Promise<string> {
  const file = formData.get("file") as File;
  if (!file) throw new Error("No file provided");

  const ext = file.name.split(".").pop() || "png";
  const fileName = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("overlay-images")
    .upload(fileName, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) throw new Error(error.message);

  const { data: urlData } = supabase.storage
    .from("overlay-images")
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}
