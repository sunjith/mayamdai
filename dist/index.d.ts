import WebSocket from "ws";
import type { ApiParams, ApiOutput } from "mayaengine-types";
export declare const connect: (apiUrl: string, apiKey: string, apiSecret: string, options?: WebSocket.ClientOptions) => Promise<string>;
export declare const request: (params: ApiParams, options?: RequestOptions) => Promise<ApiOutput>;
interface RequestOptions {
    timeout?: number;
    cancelPending?: boolean;
}
export declare const requestHttp: (params: ApiParams, apiUrl: string, options?: RequestOptions) => Promise<ApiOutput>;
export declare const close: () => Promise<string>;
export {};
