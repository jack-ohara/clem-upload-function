import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import axios from "axios"
import { once } from "events"
import { createReadStream, createWriteStream, mkdir, mkdirSync, readdirSync } from "fs"
import request from "request"

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
    console.log(event)
    const fromBase64Body = Buffer.from(event.body ?? "", 'base64').toString()
    console.log("From b64 body: ", fromBase64Body)

    const requestPayloadString = decodeURIComponent(fromBase64Body)

    if (!requestPayloadString) {
        return {
            statusCode: 400,
            body: 'No payload found in the request'
        }
    }

    console.log(requestPayloadString)

    const requestPayload = JSON.parse(requestPayloadString.split("payload=").at(-1) ?? "")

    if (requestPayload.action !== "completed") {
        return {
            statusCode: 204,
            body: 'No action required'
        }
    }

    const artifactDetailsResponse = await axios.get(requestPayload.workflow_run.artifacts_url, {
        headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `token ${process.env.GH_TOKEN}`
        }
    })

    if (artifactDetailsResponse.status !== 200 && artifactDetailsResponse.status !== 302) {
        return {
            statusCode: 502,
            body: JSON.stringify({
                error: `The call to retrieve artifact details has produced an unexpected response. Code: ${artifactDetailsResponse.status}`
            })
        }
    }

    const redirectionURL = artifactDetailsResponse.data.artifacts
        .find((artifact: any) => artifact.name === "site-build-output")
        .archive_download_url

    console.log("redirection URL: ", redirectionURL)

    const redirectionResponse = await axios.get(redirectionURL, {
        headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `token ${process.env.GH_TOKEN}`
        },
        maxRedirects: 0,
        validateStatus: (status) => status === 302
    })

    console.log(redirectionResponse)

    try {
        const zipDownloadResponse = await axios.get(redirectionResponse.headers["location"], {
            responseType: 'stream'
        })

        console.log("zip download response: ", zipDownloadResponse)

        const zipFileWritable = createWriteStream('/tmp/build.zip')

        await once(zipFileWritable, 'open')

        zipDownloadResponse.data.pipe(zipFileWritable)

        await once(zipFileWritable, 'finish')

        zipFileWritable.close()
        await once(zipFileWritable, 'close')
        
        console.log(readdirSync('/tmp'))
    } catch (e) {
        console.error(e)
    }

    return {
        statusCode: 200
    }
}