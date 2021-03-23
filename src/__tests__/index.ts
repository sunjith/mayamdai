import { close, connect, request } from "../";
import type { ApiParams } from "mayaengine-types";

const WSS_URL = process.env.WSS_URL || "wss://mayaengine-dev.mayamd.ai";
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const MISSING_AUTH_ERROR = "Authentication failed: Missing API key or secret";
const INVALID_AUTH_ERROR = "Authentication failed: Invalid API credentials";

describe("connect", () => {
  it("should error when API key and/or secret is absent", (done) => {
    connect(WSS_URL, "", "")
      .then(() => done.fail("Auth succeeded"))
      .catch((error) => {
        expect(error).toBe(MISSING_AUTH_ERROR);
        done();
      });
  });

  it("should error when API key and/or secret is incorrect", (done) => {
    connect(WSS_URL, "test", "secret")
      .then(() => done.fail("Auth succeeded"))
      .catch((error) => {
        expect(error).toBe(INVALID_AUTH_ERROR);
        done();
      });
  });

  it("should succeed when API key and/or secret is correct", (done) => {
    connect(WSS_URL, API_KEY, API_SECRET)
      .then((status) => {
        expect(status).toBe("Authenticated");
        close().then(() => done());
      })
      .catch((error) => done.fail(error));
  });
});

describe("close", () => {
  it("should succeed even if not connected", (done) => {
    close().then((status) => {
      expect(status).toBe("Closed");
      done();
    });
  });

  it("should close if connected", (done) => {
    connect(WSS_URL, API_KEY, API_SECRET)
      .then(() => {
        close().then((status) => {
          expect(status).toBe("Closed");
          done();
        });
      })
      .catch((error) => done.fail(error));
  });
});

describe("request", () => {
  beforeAll((done) => {
    connect(WSS_URL, API_KEY, API_SECRET)
      .then(() => done())
      .catch((error) => done.fail(error));
  });

  it("should get a response for a request", async () => {
    const params: ApiParams = {
      requestType: "searchSymptom",
      term: "head",
    };
    const output = await request(params);
    expect(output).toBeDefined();
    expect(output.error).toBe(false);
    expect(output.result).toBeDefined();
    expect(output.result.length).toBeGreaterThan(0);
  });

  afterAll((done) => close().then(() => done()));
});
