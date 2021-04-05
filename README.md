# mayamdai

Maya client library for MayaEngine

This library supports both Web Socket as well as HTTP modes for communication.

## Installation

npm:

```sh
npm install --save mayamdai
npm install --save-dev mayaengine-types
```

yarn:

```sh
yarn add mayamdai
yarn add --dev mayaengine-types
```

## Web Socket

Example:

```typescript
import { connect, request, close } from "mayamdai";
import type { ApiParams } from "mayaengine-types";

const WSS_API_URL = "wss://mayaengine.mayamd.ai";
const MAYA_ENGINE_API_KEY = "<your API key>";
const MAYA_ENGINE_API_SECRET = "<your API secret>";

const run = async () => {
  try {
    await connect(WSS_API_URL, MAYA_ENGINE_API_KEY, MAYA_ENGINE_API_SECRET);
    const params: ApiParams = {
      requestType: "searchSymptom",
      term: "head",
    };
    const output = await request(params);
    console.log("OUTPUT:", output);
    await close();
  } catch (error) {
    console.error("ERROR:", ERROR);
  }
}

run();
```

## HTTP

Example 1 (direct HTTP request):

```typescript
import { requestHttp } from "mayamdai";
import type { ApiParams } from "mayaengine-types";

const HTTPS_API_URL = "https://mayaengine.mayamd.ai";
const MAYA_ENGINE_API_KEY = "<your API key>";
const MAYA_ENGINE_API_SECRET = "<your API secret>";

const run = async () => {
  try {
    const params: ApiParams = {
      apiKey: MAYA_ENGINE_API_KEY,
      apiSecret: MAYA_ENGINE_API_SECRET
      requestType: "searchSymptom",
      term: "head",
    };
    const output = await requestHttp(params, HTTPS_API_URL);
    console.log("OUTPUT:", output);
  } catch (error) {
    console.error("ERROR:", ERROR);
  }
}

run();
```

Example 2 (similar to web socket):

```typescript
import { connect, request, close } from "mayamdai";
import type { ApiParams } from "mayaengine-types";

const HTTPS_API_URL = "https://mayaengine.mayamd.ai";
const MAYA_ENGINE_API_KEY = "<your API key>";
const MAYA_ENGINE_API_SECRET = "<your API secret>";

const run = async () => {
  try {
    await connect(HTTPS_API_URL, MAYA_ENGINE_API_KEY, MAYA_ENGINE_API_SECRET);
    const params: ApiParams = {
      requestType: "searchSymptom",
      term: "head",
    };
    const output = await request(params);
    console.log("OUTPUT:", output);
    await close();
  } catch (error) {
    console.error("ERROR:", ERROR);
  }
}

run();
```

## Request Types (API endpoints)

1. searchSymptom - search for a symptom (e.g: for autocomplete)

    Params:
    - term (string) - search term
    - language (string, optional) - language code for the language in which to return the results

    Output:
    - result (NamedItem[]) - top matching results
    - count (number) - number of total matching results

2. searchContext - search for a context (e.g: for autocomplete)

    Params:
    - term (string) - search term
    - language (string, optional) - language code for the language in which to return the results

    Output:
    - result (NamedItem[]) - top matching results
    - count (number) - number of total matching results

3. searchMedication - search for a medication (e.g: for autocomplete)

    Params:
    - term (string) - search term
    - language (string, optional) - language code for the language in which to return the results

    Output:
    - result (NamedItem[]) - top matching results
    - count (number) - number of total matching results

4. searchSurgery - search for a surgery (e.g: for autocomplete)

    Params:
    - term (string) - search term
    - language (string, optional) - language code for the language in which to return the results

    Output:
    - result (NamedItem[]) - top matching results
    - count (number) - number of total matching results

5. searchPastMedicalHistory - search for a past medical history cause (e.g: for autocomplete)

    Params:
    - term (string) - search term
    - language (string, optional) - language code for the language in which to return the results

    Output:
    - result (NamedItem[]) - top matching results
    - count (number) - number of total matching results

6. searchCause - search for a cause (e.g: for autocomplete)

    Params:
    - term (string) - search term
    - language (string, optional) - language code for the language in which to return the results

    Output:
    - result (NamedItem[]) - top matching results
    - count (number) - number of total matching results

7. searchSymptomWithAnatomy - search symptoms that affect a specified part of the body

    Params:
    - anatomy (string) - name of the body part
    - language (string, optional) - language code for the language in which to return the results

    Output:
    - result (NamedItem[]) - top matching results
    - count (number) - number of total matching results
8. getSymptom - get symptom data

    Params:
    - ids (number[]) - symptom IDs

    Output:
    - result (Symptom[]) - the requested symptoms data

9. getQuestion - get question data

    Params:
    - ids (number[]) - question IDs

    Output:
    - result (ApiQuestion[]) - the requested questions data

10. getContext - get context data

    Params:
    - ids (number[]) - context IDs

    Output:
    - result (ContextOutput[]) - the requested contexts data

11. getCause - get cause data

    Params:
    - ids (number[]) - cause IDs
    - age (number) - if specified, filter the result based on the age
    - sex (string: "male" or "female") - if specified, filter the result based on the sex
    - language (string, optional) - language code for the language in which to return the results
    - layperson (boolean, optional) - if true, return the results in medical terms understandable by lay people

    Output:
    - result (NamedItem[]) - the requested causes

12. getAlgorithmicSymptom - get some or all symptoms which are clinical algorithms

    Params:
    - ids (number[], optional) - symptom IDs, get all if unspecified
    - language (string, optional) - language code for the language in which to return the results
    - layperson (boolean, optional) - if true, returns all clinical algorithms that are applicable to lay people only
    - preop (boolean, optional) - if true, returns all clinical algorithms for pre-operative evaluation only
    - category (string, optional) - if specified, returns clinical algorithms of that particular category only

    Output:
    - result (AlgorithmSymptom[]) - the requested symptom data

13. replaceSymptoms - get replaced symptoms if there are replacement rules

    Params:
    - symptoms (InputSymptom[]) - input symptoms

    Output:
    - result (InputSymptom[]) - input symptoms after replacements (if any)

14. analyze - analyze the input and generate recommendations

    Params:
    - input (ApiInput) - input data
    - language (string, optional) - language code for the language in which to return the results
    - algorithm (boolean, optional) - if true, return the results for clinical algorithms
    - layperson (boolean, optional) - if true, return the results for lay people apps
    - contextOnly (boolean, optional) - if true, return only applicable contexts for the case

    Output:
    - workup (Workup[]) - workup questions (only in professional mode - when layperson is unspecified or false)
    - inferences (InferenceOutput[]) - medical inferences (except when contextOnly is true)
    - diagnoses (Diagnosis[]) - differential diagnosis (except when contextOnly is true)
    - triages (TriageOutput[]) - triage (except when contextOnly is true)
    - recommendation (Recommendation) - lab and physical examination recommendations (except when contextOnly is true)
    - contexts (ContextOutput[]) - Contexts applicable for the case (only when contextOnly is true)

15. noop - no operation, just returns a success result. Used by the client library to verify authentication in HTTP mode.

## Events

Currently there are events only for the web socket connection, although connect returns an event emitter in either case.

1. partial - emitted when a partial output is received. Only one parameter of type ApiOutput.

2. socketError - emitted when a socket error occurs. Only one parameter of type Error.

3. socketClose - emitted when the socket is closed. No parameter.

4. socketOpen - emitted when the socket is opened. Note: Initial socket open will not emit this because the connect function will resolve only after successful authentication.

## Partial Outputs (only on web socket connection)

The connect function returns an event emitter. For partial responses after the first part, listen on 'partial' event. Partial can be used for responsiveness when the network is slow and/or the data is huge, so that the output can be incrementally rendered to the user before the whole data is received.

Example:

```typescript
import { connect, request, close } from "mayamdai";
import type { ApiParams } from "mayaengine-types";

const WSS_API_URL = "wss://mayaengine.mayamd.ai";
const MAYA_ENGINE_API_KEY = "<your API key>";
const MAYA_ENGINE_API_SECRET = "<your API secret>";

const run = async () => {
  try {
    const mayamdai = await connect(WSS_API_URL, MAYA_ENGINE_API_KEY, MAYA_ENGINE_API_SECRET);
    mayamdai.on('partial', (output) => {
      console.log("Additional partial output:", output);
    })
    const params: ApiParams = {
        requestType: "analyze",
        partial: true,
        layperson: true,
        algorithm: false,
        excludingSex: "F",
        input: {
          age: 45,
          sex: "male",
          countryName: "US",
          symptoms: [{ id: 7704, duration: 14, qualifiers: [87] }],
          contexts: [12],
          negativeContexts: [15],
        },
      };
    const output = await request(params);
    console.log("Initial OUTPUT:", output);
    await new Promise((r) => setTimeout(r, 2000)); // wait for 2 seconds
    await close();
  } catch (error) {
    console.error("ERROR:", ERROR);
  }
}

run();
```
