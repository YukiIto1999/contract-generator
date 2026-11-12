import "../dist/index.js";

using TypeSpec.Reflection;

namespace ContractGenerator;

/**
 * Nominal scalar role independent of wire representation
 * @param target Scalar owning a separate nominal role
 */
extern dec distinct(target: Scalar);

/**
 * Named operation result paths rather than a payload union
 * @param target Named exhaustive operation result union
 */
extern dec outcomes(target: Union);

/**
 * Scalar source spelling retention independent of nominal role
 * @param target Scalar requiring source spelling in addition to its value
 */
extern dec preserveLexical(target: Scalar);

/**
 * Mandatory transport interpretations
 * @param target Operation requiring every listed binding
 * @param bindings Required transports
 */
extern dec publish(target: Operation, bindings: valueof ("http" | "ipc")[]);

/**
 * HTTP route and request body ownership
 * @param target Operation receiving the HTTP route
 * @param method HTTP request method
 * @param path Absolute route template of nonempty segments without dot segments, where each placeholder fills a whole segment
 * @param body Parameter name or * for remaining parameters or - for no body
 */
extern dec httpBinding(target: Operation, method: valueof string, path: valueof string, body?: valueof string);

/**
 * Nonbody scalar parameter placement
 * @param target Operation owning the input parameter
 * @param parameter Canonical operation parameter name
 * @param location HTTP parameter location
 * @param wireName Name on the wire
 */
extern dec httpParameter(target: Operation, parameter: valueof string, location: valueof ("path" | "query" | "header"), wireName: valueof string);

/**
 * Exact result identification before body decoding
 * @param target Operation owning the named outcome
 * @param outcomeName Canonical named result
 * @param status Exact HTTP response status
 * @param mediaType Body media type absent for a void result
 * @param headers Exact header selectors
 */
extern dec httpResult(target: Operation, outcomeName: valueof string, status: valueof int32, mediaType?: valueof string, headers?: valueof Record<string>);

/**
 * Host supplied IPC command
 * @param target Operation exposed through the host transport
 * @param command Transport command name
 */
extern dec ipcBinding(target: Operation, command: valueof string);

/**
 * Exact IPC envelope result identification
 * @param target Operation owning the named outcome
 * @param outcomeName Canonical named result
 * @param tag Unique response tag
 */
extern dec ipcResult(target: Operation, outcomeName: valueof string, tag: valueof string);

/**
 * Binding-local wire representation
 * @param target Scalar or scalar-valued property receiving the override
 * @param binding Transport whose encoding is overridden
 * @param encoding Representation for this binding
 */
extern dec bindingEncoding(target: Scalar | ModelProperty, binding: valueof ("http" | "ipc"), encoding: valueof ("json" | "string" | "base64" | "base64url" | "rfc3339" | "unixTimestamp"));

/**
 * Provider acceptance default applied only to an omitted optional field
 * @param target Optional field receiving the provider-only default
 * @param value Exact logical constant validated against the normalized field contract for every binding: numbers and booleans are written as values even when a binding encodes them as text, bytes are an array of integers from 0 through 255, and date-times and durations use their fromISO constructor (a utcDateTime has a zero offset, a duration is the date-time form or a bare PnW week form)
 */
extern dec providerDefault(target: ModelProperty, value: valueof (numeric | unknown));
