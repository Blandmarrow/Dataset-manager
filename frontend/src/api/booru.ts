import client from "./client";
import type { BooruTag } from "../types";

export const booruApi = {
  search: (q: string, source: "safebooru" | "gelbooru" = "safebooru", limit = 20) =>
    client.get<BooruTag[]>("/booru/search", { params: { q, source, limit } }).then((r) => r.data),
  autocomplete: (prefix: string, source = "safebooru", limit = 10) =>
    client.post<BooruTag[]>("/booru/autocomplete", { prefix, source, limit }).then((r) => r.data),
};
