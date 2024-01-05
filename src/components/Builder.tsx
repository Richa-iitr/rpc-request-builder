"use client";

import { useState, useEffect } from "react";
import { Methods } from "@/api/rpcspec";
import Editor from "@monaco-editor/react";
import {
  MAINNET_RPC_URL,
  GOERLI_RPC_URL,
  SEPOLIA_RPC_URL,
  DEFAULT_CURL_REQUEST,
  DEFAULT_STARKNET_JS_REQUEST,
  DEFAULT_RAW_REQUEST,
  DEFAULT_RAW_RESPONSE,
  DEFAULT_DECODED_RESPONSE,
} from "./constant";
import { selector } from "starknet";

const formatName = (name: string) => {
  // Make first letter uppercase
  name = name.charAt(0).toUpperCase() + name.slice(1);
  // turn _ into space
  return name.replace(/_/g, " ");
};

const Builder = () => {
  const transformParamsToArray = (params: any) => {
    const transformParam = (param: any): any => {
      if (param.description || param.placeholder) {
        if (param.oneOf) {
          return {
            description: param.description,
            index: param.index,
            value: param.oneOf.map((option: any) => ({
              name: option.name,
              placeholder: option.placeholder,
              pattern: option.pattern,
              enum: option.enum,
            })),
          };
        } else {
          return {
            description: param.description,
            placeholder: param.placeholder,
          };
        }
      } else if (!param.placeholder && !param.description) {
        let params = {};
        for (const [key, value] of Object.entries(param)) {
          params = {
            ...params,
            [key]: {
              ...transformParam(value),
              name: key,
            },
          };
        }

        return params;
      }
      return {};
    };

    return params
      ? Object.entries(params).flatMap(([name, value]) => {
          if (Array.isArray(value)) {
            let values = value.map((param: any) => {
              return transformParam(param);
            });

            return { name, value: values };
          }
          return { name, value: transformParam(value) };
        })
      : [];
  };

  const [method, setMethod] = useState(Methods[0]);
  const [paramsArray, setParamsArray] = useState(
    Methods[0].params ? transformParamsToArray(Methods[0].params) : []
  );
  const [rpcUrl, setRpcUrl] = useState(MAINNET_RPC_URL);
  const [useCustomRpcUrl, setUseCustomRpcUrl] = useState(false);

  const [requestTab, setRequestTab] = useState("raw");
  const [starknetJs, setStarknetJs] = useState(DEFAULT_STARKNET_JS_REQUEST);
  const [curlRequest, setCurlRequest] = useState(DEFAULT_CURL_REQUEST);
  const [rawRequest, setRawRequest] = useState(DEFAULT_RAW_REQUEST);

  const [responseTab, setResponseTab] = useState("raw");
  const [response, setResponse] = useState(DEFAULT_RAW_RESPONSE);
  const [decodedResponse, setDecodedResponse] = useState(
    DEFAULT_DECODED_RESPONSE
  );
  const copyToClipboard = (type: string) => {
    if (type == "request") {
      navigator.clipboard.writeText(
        requestTab == "raw"
          ? rawRequest
          : requestTab == "curl"
          ? curlRequest
          : starknetJs
      );
    } else {
      navigator.clipboard.writeText(response);
    }
  };

  const updateRpcUrl = (newRpcUrl: string, oldRpcUrl: string) => {
    // remove everything before the first \
    let dataPart = curlRequest.split("\\")[1];
    let urlPart = `curl --location '${newRpcUrl}' \\`;

    let newCurlRequest = urlPart + dataPart;
    setCurlRequest(newCurlRequest);

    // Replace oldRpcUrl with newRpcUrl
    let newStarknetJs = starknetJs.replace(oldRpcUrl, newRpcUrl);
    setStarknetJs(newStarknetJs);

    // update all methods as well
    Methods.forEach((method) => {
      let newStarknetJs = method.starknetJs.replace(oldRpcUrl, newRpcUrl);
      method.starknetJs = newStarknetJs;
    });
    return newCurlRequest;
  };

  interface ParamsObject {
    [key: string]: any;
  }

  const constructParamsArray = (latestParamsArray: any) => {
    const processPlaceholder = (latestParams: any, isEntryPoint: boolean) => {
      let placeholder = latestParams.placeholder;
      if (isEntryPoint) {
        placeholder = selector.getSelectorFromName(placeholder);
      }
      return placeholder;
    };

    const constructParams = (latestParams: any, isEntryPoint: boolean): any => {
      if (!latestParams.description) {
        return Object.entries(latestParams).reduce(
          (acc: ParamsObject, [key, value]) => {
            acc[key] = Array.isArray(value)
              ? value.map((val) =>
                  constructParams(val, key === "entry_point_selector")
                )
              : constructParams(value, key === "entry_point_selector");
            return acc;
          },
          {}
        );
      } else if (latestParams?.value?.length > 0) {
        const selectedOption = latestParams.value[latestParams.index];
        const placeholder = processPlaceholder(selectedOption, isEntryPoint);
        return selectedOption.enum
          ? placeholder
          : { [selectedOption.name]: placeholder };
      } else {
        return processPlaceholder(latestParams, isEntryPoint);
      }
    };

    return latestParamsArray.map((param: any) => {
      if (Array.isArray(param.value)) {
        return param.value.map((val: any) =>
          constructParams(val, val.name === "entry_point_selector")
        );
      }
      return constructParams(
        param.value,
        param.name === "entry_point_selector"
      );
    });
  };

  const sendRequest = async () => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: rawRequest,
    });
    const json = await response.json();
    setResponse(JSON.stringify(json, null, 2));
  };

  useEffect(() => {
    const responseJSON = JSON.parse(response);
    const decodedResponseJSON = responseJSON.result
      ? { result: responseJSON.result }
      : { error: responseJSON.error };
    setDecodedResponse(JSON.stringify(decodedResponseJSON, null, 2));
  }, [response]);

  useEffect(() => {
    const updateStarknetJsParams = (currentParamsArray: Array<any>) => {
      const regexPattern = /provider\.(\w+)\(([^)]*)\)/;
      const codeSnippet = method.starknetJs;

      // TODO: Modify this so it can support starknet.js for methods with nested params
      const updatedCode = codeSnippet.replace(
        regexPattern,
        (match, methodName, params) => {
          const values = currentParamsArray.map((item) => {
            // Check if the item is an object
            if (item && typeof item === "object" && !Array.isArray(item)) {
              const objectItem = Object.values(item)[0];
              if (typeof objectItem === "string") {
                return `"${Object.values(item)}"`;
              } else if (typeof objectItem === "number") {
                return Object.values(item);
              }
              return item;
            } else {
              if (item && typeof item === "string") {
                return `"${item}"`;
              }
              return item;
            }
          });

          let stringifiedParams = values.join(", ");

          return `provider.${methodName}(${stringifiedParams})`;
        }
      );

      return updatedCode;
    };

    const updateMethod = (methodName: string, latestParamsArray: any) => {
      const params = constructParamsArray(latestParamsArray);
      const jsonObject = {
        jsonrpc: "2.0",
        method: methodName,
        params,
        id: 1,
      };
      const jsonDataString = JSON.stringify(jsonObject, null, 4);

      const curlPart = `curl --location '${rpcUrl}' \\\n`;
      const curlCommand = `${curlPart}--data '${jsonDataString}'`;
      const newStarknetJsParams = updateStarknetJsParams(params);
      setRawRequest(jsonDataString);
      setCurlRequest(curlCommand);
      setStarknetJs(newStarknetJsParams);
    };

    updateMethod(method.name, paramsArray);
  }, [method, paramsArray, rpcUrl]);

  const handlePlaceholderChange = (placeholder: any, newValue: any) => {
    if (typeof placeholder === "number") {
      return parseInt(newValue);
    } else if (Array.isArray(placeholder)) {
      return newValue.split(",");
    }
    return newValue;
  };

  const FormatInputField = ({
    param,
    index,
  }: {
    param: any;
    index: number;
  }) => {
    return (
      <>
        {
          // check if param.value is not an array and also doesn't have a description
          // That means it is an object
          !param.description ? (
            Object.entries(param).map(([key, value]: any) => (
              <div key={key}>
                <p className="mt-3">{formatName(key)}</p>
                <p className="mt-3 text-xs">{value.description}</p>
                <input
                  value={
                    Array.isArray(value.placeholder)
                      ? value.placeholder?.join(",")
                      : value.placeholder
                  }
                  onChange={(e) => {
                    setParamsArray((prevParamsArray) => {
                      const updatedParamsArray = JSON.parse(
                        JSON.stringify(prevParamsArray)
                      );

                      // Reference to the specific placeholder
                      let placeholder =
                        updatedParamsArray[index].value[key].placeholder;

                      // Check the type and update the placeholder accordingly
                      placeholder = handlePlaceholderChange(
                        placeholder,
                        e.target.value
                      );

                      // Update the placeholder in the deep structure
                      updatedParamsArray[index].value[key].placeholder =
                        placeholder;

                      return updatedParamsArray;
                    });
                  }}
                  className="bg-gray-bg border border-[#3e3e43] rounded-sm p-2 w-full mt-2"
                />
              </div>
            ))
          ) : (
            <>
              {param.value?.length > 0 ? (
                <div>
                  <select
                    defaultValue={param.value[0].name}
                    onChange={(e) => {
                      setParamsArray((prevParamsArray) => {
                        const updatedParamsArray = [...prevParamsArray];
                        (
                          updatedParamsArray[index].value as {
                            index: any;
                          }
                        ).index = e.target.selectedIndex;
                        return updatedParamsArray;
                      });
                    }}
                    className="bg-gray-bg border border-[#3e3e43] rounded-sm p-2 w-full mt-2"
                  >
                    {
                      // @ts-ignore
                      param.value?.map((option, index) => (
                        <option key={index} value={option.value}>
                          {option.name}
                        </option>
                      ))
                    }
                  </select>
                  <input
                    onChange={(e) => {
                      setParamsArray((prevParamsArray) => {
                        const updatedParamsArray = JSON.parse(
                          JSON.stringify(prevParamsArray)
                        );
                        const selectedIndex =
                          updatedParamsArray[index].value.index;
                        let value: string | number =
                          updatedParamsArray[index].value?.value[selectedIndex]
                            .placeholder;
                        if (typeof value == "number") {
                          value = parseInt(e.target.value);
                        } else {
                          value = e.target.value;
                        }
                        updatedParamsArray[index].value.value[
                          selectedIndex
                        ].placeholder = value;

                        return updatedParamsArray;
                      });
                    }}
                    className="bg-gray-bg border border-[#3e3e43] rounded-sm p-2 w-full mt-2"
                    value={
                      Array.isArray(param.value[param.index]?.placeholder)
                        ? param.value[param.index]?.placeholder?.join(",")
                        : param.value[param.index]?.placeholder
                    }
                  />
                </div>
              ) : (
                <div>
                  <input
                    onChange={(e) => {
                      setParamsArray((prevParamsArray) => {
                        const updatedParamsArray = JSON.parse(
                          JSON.stringify(prevParamsArray)
                        );
                        let placeholder =
                          updatedParamsArray[index].value.placeholder;

                        placeholder = handlePlaceholderChange(
                          placeholder,
                          e.target.value
                        );

                        updatedParamsArray[index].value.placeholder =
                          placeholder;
                        return updatedParamsArray;
                      });
                    }}
                    className="bg-gray-bg border border-[#3e3e43] rounded-sm p-2 w-full mt-2"
                    value={
                      Array.isArray(param.placeholder)
                        ? param.placeholder?.join(",")
                        : param.placeholder
                    }
                  />
                </div>
              )}
            </>
          )
        }
      </>
    );
  };

  return (
    <>
      <div className="lg:flex m-5 sm:m-1 bg-gray-bg text-sm">
        <div className="sm:w-full lg:w-1/3 p-3">
          <h2 className="my-2 text-lg">Configure Request</h2>
          <div className="my-5">
            {useCustomRpcUrl ? (
              <div>
                <input
                  onChange={(e) => {
                    let oldRpcUrl = rpcUrl;
                    setRpcUrl(e.target.value);
                    updateRpcUrl(e.target.value, oldRpcUrl);
                  }}
                  className="bg-gray-bg border border-[#3e3e43] rounded-sm p-2 w-full"
                  value={rpcUrl}
                />
                <p
                  onClick={() => setUseCustomRpcUrl(!useCustomRpcUrl)}
                  className="text-xs my-3 text-cyan-400 cursor-pointer"
                >
                  Use default RPC URL
                </p>
              </div>
            ) : (
              <div>
                <select
                  onChange={(e) => {
                    let oldRpcUrl = rpcUrl;
                    setRpcUrl(e.target.value);
                    updateRpcUrl(e.target.value, oldRpcUrl);
                  }}
                  className="bg-gray-bg border border-[#3e3e43] rounded-sm p-2 w-full"
                >
                  <option value={MAINNET_RPC_URL}>Mainnet</option>
                  <option value={GOERLI_RPC_URL}>Goerli</option>
                  <option value={SEPOLIA_RPC_URL}>Sepolia</option>
                </select>
                <p
                  onClick={() => setUseCustomRpcUrl(!useCustomRpcUrl)}
                  className="text-xs my-3 text-cyan-400 cursor-pointer"
                >
                  Use custom RPC URL
                </p>
              </div>
            )}

            <select
              onChange={(e) => {
                const index = parseInt(e.target.value);
                const latestParamsArray = Methods[index].params
                  ? transformParamsToArray(Methods[index].params)
                  : [];

                setMethod(Methods[index]);
                setParamsArray(latestParamsArray);
              }}
              className="bg-gray-bg border border-[#3e3e43] rounded-sm p-2 w-full mt-2"
            >
              {Methods.map((method, index) => (
                <option key={method.name} value={index}>
                  {method.name}
                </option>
              ))}
            </select>
            {
              // Loops through all parameters and renders them
              paramsArray.map((param, index) => (
                <div key={index}>
                  <p className="mt-3">{formatName(param.name)}</p>
                  <p className="mt-3 text-xs">{param.value?.description}</p>
                  {Array.isArray(param.value) ? (
                    <>
                      {param.value.map((option: any, ind: number) => (
                        <div className="mt-3" key={ind}>
                          <p>Option {ind}</p>
                          <FormatInputField param={option} index={index} />
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          setParamsArray((prevParamsArray) => {
                            const updatedParamsArray = JSON.parse(
                              JSON.stringify(prevParamsArray)
                            );
                            updatedParamsArray[index].value.push({
                              ...updatedParamsArray[index].value[0],
                            });
                            return updatedParamsArray;
                          });
                        }}
                        className="bg-[#3e3e43] text-white rounded-sm p-2 w-full mt-2"
                      >
                        Add another option
                      </button>
                    </>
                  ) : (
                    <>
                      <FormatInputField param={param.value} index={index} />
                    </>
                  )}
                </div>
              ))
            }
            <button
              onClick={() => {
                sendRequest();
              }}
              className="bg-[#3e3e43] text-white rounded-sm p-2 w-1/2 mt-2"
            >
              Send Request
            </button>
          </div>
        </div>
        <div className="lg:w-2/3">
          <div>
            <h2 className="p-3 text-lg">Request Preview</h2>
            <div className="m-5 bg-[#232326] rounded">
              <ul className="flex">
                <li
                  onClick={() => setRequestTab("raw")}
                  className="p-3 cursor-pointer"
                >
                  Raw
                </li>
                <li
                  onClick={() => setRequestTab("curl")}
                  className="p-3 cursor-pointer"
                >
                  cURL
                </li>
                {method.starknetJs && (
                  <li
                    onClick={() => setRequestTab("starknetJs")}
                    className="p-3 cursor-pointer"
                  >
                    starknet.js
                  </li>
                )}
              </ul>
              <div className="bg-[#1e1e1e]">
                <button
                  onClick={() => copyToClipboard("request")}
                  className="p-3 float-right"
                >
                  Copy
                </button>
                {requestTab == "raw" && (
                  <Editor
                    height="30vh"
                    language="json"
                    theme="vs-dark"
                    value={rawRequest}
                    options={{
                      readOnly: true,
                      fontSize: 14,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      scrollbar: {
                        horizontal: "hidden",
                      },
                    }}
                  />
                )}
                {requestTab == "starknetJs" && (
                  <Editor
                    height="30vh"
                    language="javascript"
                    theme="vs-dark"
                    value={starknetJs}
                    options={{
                      readOnly: true,
                      fontSize: 14,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      scrollbar: {
                        horizontal: "hidden",
                      },
                    }}
                  />
                )}
                {requestTab == "curl" && (
                  <Editor
                    height="30vh"
                    language="shell"
                    theme="vs-dark"
                    value={curlRequest}
                    options={{
                      readOnly: true,
                      fontSize: 14,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      scrollbar: {
                        horizontal: "hidden",
                      },
                    }}
                  />
                )}
              </div>
            </div>
          </div>
          <div>
            <h2 className="p-3 text-lg">Response Preview</h2>
            <div className="m-5 bg-[#232326] rounded">
              <ul className="flex">
                <li
                  onClick={() => setResponseTab("raw")}
                  className="p-3 cursor-pointer"
                >
                  Raw
                </li>
                <li
                  onClick={() => setResponseTab("decoded")}
                  className="p-3 cursor-pointer"
                >
                  Decoded
                </li>
              </ul>
              <div className="bg-[#1e1e1e]">
                <button
                  onClick={() => copyToClipboard("response")}
                  className="p-3 float-right"
                >
                  Copy
                </button>
                {responseTab == "raw" && (
                  <Editor
                    height="30vh"
                    language="json"
                    theme="vs-dark"
                    value={response}
                    options={{
                      readOnly: true,
                      fontSize: 14,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      scrollbar: {
                        horizontal: "hidden",
                      },
                    }}
                  />
                )}
                {responseTab == "decoded" && (
                  <Editor
                    height="30vh"
                    language="json"
                    theme="vs-dark"
                    value={decodedResponse}
                    options={{
                      readOnly: true,
                      fontSize: 14,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      scrollbar: {
                        horizontal: "hidden",
                      },
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const InputField = ({
  onChange,
  defaultValue,
  className,
}: {
  onChange: any;
  defaultValue: any;
  className: any;
}) => (
  <input
    onChange={onChange}
    className={className}
    defaultValue={defaultValue}
  />
);

export default Builder;
