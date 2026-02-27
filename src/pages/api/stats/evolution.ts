import type { APIRoute } from 'astro';
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";
import { getMockEvolution } from "../../../lib/mock-data";

export const GET: APIRoute = async ({ request, cookies }) => {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const days = parseInt(url.searchParams.get('days') || '30');

  if (!projectId) {
    return new Response(JSON.stringify({ error: 'Project ID is required' }), {
      status: 400,
    });
  }

  // In demo mode, return mock evolution data
  if (isDemoMode) {
    const mockData = getMockEvolution(days);
    return new Response(JSON.stringify(mockData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  const supabase = getAuthenticatedSupabase(cookies);

  // Calculate start date
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('vista_finanzas_diarias')
    .select('dia, ingresos, urp')
    .eq('proyecto_id', projectId)
    .gte('dia', startDateStr)
    .order('dia', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  // Fill missing dates with 0
  const filledData = [];
  const currentDate = new Date(startDate);
  const endDate = new Date();

  // Create a map for quick lookup
  const dataMap = new Map<string, { dia: string; ingresos: number; urp: number }>(data.map((item: { dia: string; ingresos: number; urp: number }) => [item.dia, item]));

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const item = dataMap.get(dateStr);

    filledData.push({
      date: dateStr,
      ingresos: item ? Number(item.ingresos) : 0,
      urp: item ? Number(item.urp) : 0,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return new Response(JSON.stringify(filledData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
};