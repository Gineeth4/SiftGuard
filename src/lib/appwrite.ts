import { Client, TablesDB } from "node-appwrite";
import { appConfig } from "./config";

const client = new Client()
  .setEndpoint(appConfig.appwriteEndpoint)
  .setProject(appConfig.appwriteProjectId)
  .setKey(appConfig.appwriteApiKey);

export const tablesDB = new TablesDB(client);