import axios from "axios";

const client = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

export default client;
