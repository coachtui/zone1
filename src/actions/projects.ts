"use server";

import { supabase } from "@/lib/supabase";
import { Project } from "@/lib/types";

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createProject(input: {
  name: string;
  description?: string;
  center_lng: number;
  center_lat: number;
  zoom: number;
}): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
