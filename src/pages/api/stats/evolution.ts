import type { APIRoute } from "astro";
import { getMockEvolution } from "../../../lib/mock-data";
import { backendError, jsonResponse, sessionBackend, unauthorizedResponse } from "../../../lib/legacy-api";
import { isDemoMode } from "../../../lib/supabase";

export const GET: APIRoute = async (context) => {
    const projectId = Number(context.url.searchParams.get("projectId"));
    const days = Math.max(1, Number.parseInt(context.url.searchParams.get("days") || "30", 10));

    if (!Number.isInteger(projectId) || projectId <= 0) {
        return jsonResponse({ error: "Project ID is required" }, 400);
    }

    if (isDemoMode) return jsonResponse(getMockEvolution(days));

    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();

    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split("T")[0];
        const data = await session.backend.financeEvolution(projectId, startDateStr);
        const dataMap = new Map(
            data.map((item) => [String(item.dia), {
                ingresos: Number(item.ingresos ?? 0),
                urp: Number(item.urp ?? 0),
            }]),
        );

        const filledData: Array<{ date: string; ingresos: number; urp: number }> = [];
        const currentDate = new Date(startDate);
        const endDate = new Date();
        while (currentDate <= endDate) {
            const date = currentDate.toISOString().split("T")[0];
            const item = dataMap.get(date);
            filledData.push({ date, ingresos: item?.ingresos ?? 0, urp: item?.urp ?? 0 });
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return jsonResponse(filledData);
    } catch (error) {
        return backendError(error);
    }
};
