const express = require("express");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
require("dotenv").config(); // Load environment variables

const { generateContent } = require("./controllers/ContentController");
const { fetchPixabayVideos } = require("./controllers/pixabayController");
const { fetchPexelsVideos } = require("./controllers/PexelsController");
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
app.use(express.json());
app.use(cors());

// Serve static files (e.g., audio files)
app.use("/temp", express.static(path.join(__dirname, "temp")));


// Fetch videos from Pixabay API
app.post("/api/fetch-videos", async (req, res) => {
  const { keywords, limit = 30, orientation = "landscape" } = req.body;

  try {
    const videos = await fetchPixabayVideos(keywords, limit, orientation);
    const filteredVideos = videos.filter((hit) => {
      const videoWidth = hit.videos.large.width;
      const videoHeight = hit.videos.large.height;
      return orientation === "landscape"
        ? videoWidth > videoHeight
        : videoWidth < videoHeight;
    });

    const formattedVideos = filteredVideos.map((hit) => ({
      url: hit.videos.large.url,
      title: hit.tags,
      width: hit.videos.large.width,
      height: hit.videos.large.height,
      duration: hit.duration, // Include duration for client reference
    }));

    res.json({ videos: formattedVideos });
  } catch (error) {
    console.error("Error fetching videos:", error);
    res.status(500).json({ error: "Error fetching videos." });
  }
});
// Fetch videos from Pexels API
app.post("/api/fetch-pexels-videos", async (req, res) => {
  const { keywords, limit = 30 } = req.body;

  try {
    const videos = await fetchPexelsVideos(keywords, limit);

    if (!videos || videos.length === 0) {
      return res.json({ videos: [] });
    }

    res.json({ videos });
  } catch (error) {
    console.error("Error fetching videos from Pexels:", error.message);
    res.status(500).json({ error: "Error fetching Pexels videos." });
  }
});


// Text-to-speech conversion
const convertTextToSpeech = async (text, language, voiceId, useGoogleTTS) => {
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  if (useGoogleTTS) {
    return await generateGoogleTTSAudio(text, language, tempDir);
  } else {
    // Use ElevenLabs TTS
    const audioPath = path.join(tempDir, "output_audio.mp3");
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      { text },
      {
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
        responseType: "arraybuffer",
      }
    );
    fs.writeFileSync(audioPath, response.data);
    return `http://localhost:5000/temp/output_audio.mp3`;
  }
};

const generateGoogleTTSAudio = async (text, language, tempDir) => {
  const splitTextIntoChunks = (text, maxLength) => {
    const regex = new RegExp(`.{1,${maxLength}}(\\s|$)`, "g");
    return text.match(regex).map((chunk) => chunk.trim());
  };

  const textChunks = splitTextIntoChunks(text, 200);
  const chunkFiles = [];

  for (const [index, chunk] of textChunks.entries()) {
    const chunkPath = path.join(tempDir, `chunk_${index}.mp3`);
    const googleTTSUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${language}&client=tw-ob&q=${encodeURIComponent(chunk)}`;

    try {
      const response = await axios({ url: googleTTSUrl, method: "GET", responseType: "stream" });
      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(chunkPath);
        response.data.pipe(writer);
        writer.on("finish", () => {
          chunkFiles.push(chunkPath);
          resolve();
        });
        writer.on("error", reject);
      });
    } catch (error) {
      console.error(`Error processing chunk ${index}:`, error.message);
      throw new Error(`Failed to process Google TTS chunk at index ${index}.`);
    }
  }

  // Merge audio chunks
  const outputAudioPath = path.join(tempDir, "output_audio.mp3");
  const concatListPath = path.join(tempDir, "concat_list.txt");
  fs.writeFileSync(concatListPath, chunkFiles.map((file) => `file '${file}'`).join("\n"));

  try {
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f concat", "-safe 0"])
        .output(outputAudioPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    // Cleanup temporary chunk files
    chunkFiles.forEach((file) => fs.unlinkSync(file));
    fs.unlinkSync(concatListPath);

    // ✅ Apply Speed Increase using FFmpeg
    const speedFactor = 1.3; // Adjust speed (1.5x faster)
    const fastAudioPath = path.join(tempDir, "fast_output_audio.mp3");

    await new Promise((resolve, reject) => {
      ffmpeg(outputAudioPath)
        .audioFilters(`atempo=${speedFactor}`)
        .output(fastAudioPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    // Cleanup the original slower audio
    fs.unlinkSync(outputAudioPath);

    return `http://localhost:5000/temp/fast_output_audio.mp3`; // Return the faster version
  } catch (error) {
    console.error("Error merging Google TTS audio chunks:", error.message);
    throw new Error("Failed to merge Google TTS audio chunks.");
  }
};


// Generate content and convert it to voice
app.post("/api/generate-content", async (req, res) => {
  const { inputType, userInput, language, voiceId, useGoogleTTS } = req.body;

  try {
    const content = await generateContent(inputType, userInput);

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: `Extract the main keyword or topic from the following content:\n\n${content}`,
        },
      ],
      max_tokens: 10,
      temperature: 0.5,
    });

    const keyword = response.choices[0].message.content.trim();

    // Convert text to speech
    const audioPath = await convertTextToSpeech(content, language, voiceId, useGoogleTTS);

    res.json({
      content,
      keyword,
      audioPath,
    });
  } catch (error) {
    console.error("Error generating content or converting to voice:", error);
    res.status(500).json({ error: "Failed to generate content or voice." });
  }
});



// Trim videos and merge them
// Helper function to get the duration of a media file
const getMediaDuration = (filePath) =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });

// Helper function to loop the audio to match the video duration
const loopAudio = (inputAudioPath, outputAudioPath, videoDuration) =>
  new Promise((resolve, reject) => {
    ffmpeg(inputAudioPath)
      .inputOptions(["-stream_loop -1"]) // Loop the audio infinitely
      .outputOptions([`-t ${videoDuration}`]) // Trim the audio to match video duration
      .output(outputAudioPath)
      .on("end", () => {
        console.log("Audio looped successfully.");
        resolve();
      })
      .on("error", (err) => {
        console.error("Error looping audio:", err);
        reject(err);
      })
      .run();
  });

// Helper function to extend video duration to match the audio duration
const extendVideo = (inputVideoPath, outputVideoPath, audioDuration) =>
  new Promise((resolve, reject) => {
    ffmpeg(inputVideoPath)
      .inputOptions(["-stream_loop -1"]) // Loop the video infinitely
      .outputOptions([`-t ${audioDuration}`]) // Trim the video to match audio duration
      .output(outputVideoPath)
      .on("end", () => {
        console.log("Video extended successfully.");
        resolve();
      })
      .on("error", (err) => {
        console.error("Error extending video:", err);
        reject(err);
      })
      .run();
  });

  app.post("/api/merge-videos", async (req, res) => { // This is the async function
    const { videoUrls } = req.body;
  
    if (!videoUrls || videoUrls.length === 0) {
      return res.status(400).json({ error: "No video URLs provided." });
    }
  
    try {
      const tempDir = path.join(__dirname, "temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
  
      const processedFiles = [];
  
 
        // Get the audio duration before processing videos
        const audioPath = path.join(tempDir, "fast_output_audio.mp3"); // Path for audio file
        if (!fs.existsSync(audioPath)) {
            console.error("Audio file does not exist.");
            return res.status(500).json({ error: "Audio file not found." });
        }

        const audioDuration = await getMediaDuration(audioPath); // Retrieve audio duration
        console.log("Audio Duration:", audioDuration);

        if (!audioDuration || isNaN(audioDuration)) {
            return res.status(500).json({ error: "Invalid audio duration." });
        }

        // Calculate trim duration
        const trimDuration = audioDuration / videoUrls.length; // Updated trimming logic
        console.log("Trim Duration:", trimDuration);

        // Download, normalize, and trim videos
        for (const [index, url] of videoUrls.entries()) {
            const filePath = path.join(tempDir, `video${index}.mp4`);
            const trimmedPath = path.join(tempDir, `trimmed_video${index}.mp4`);
            const normalizedPath = path.join(tempDir, `normalized_video${index}.mp4`);

            // Download the video
            const writer = fs.createWriteStream(filePath);
            const response = await axios({ url, method: "GET", responseType: "stream" });
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
            });

            // Check video duration and trim if necessary
            await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(filePath, async (err, metadata) => {
                    if (err) return reject(err);

                    const duration = metadata.format.duration;
                    if (duration > trimDuration) {
                        // Trim the video using the new formula
                        ffmpeg(filePath)
                            .setStartTime(0)
                            .setDuration(trimDuration) // Updated trimming duration
                            .output(trimmedPath)
                            .on("end", async () => {
                                // Normalize the trimmed video
                                await normalizeVideo(trimmedPath, normalizedPath);
                                processedFiles.push(normalizedPath);
                                resolve();
                            })
                            .on("error", reject)
                            .run();
                    } else {
                        // Normalize the original video if it's already shorter
                        await normalizeVideo(filePath, normalizedPath);
                        processedFiles.push(normalizedPath);
                        resolve();
                    }
                });
            });
        }

      // Generate FFMPEG file list
      const listFile = path.join(tempDir, "filelist.txt");
      const listContent = processedFiles.map((file) => `file '${file.replace(/\\/g, "/")}'`).join("\n");
      fs.writeFileSync(listFile, listContent, "utf8");
  
      // Merge videos using FFMPEG
      const outputFilePath = path.join(tempDir, "merged_output.mp4");
      ffmpeg()
        .input(listFile)
        .inputOptions(["-f concat", "-safe 0"])
        .output(outputFilePath)
        .on("end", async () => {
          console.log("Videos merged successfully.");
  
          // Add and synchronize audio with video
          const audioPath = path.join(tempDir, "fast_output_audio.mp3"); // Path for audio file
          console.log("Audio file path:", audioPath); // Log the audio path for debugging
          const finalVideoPath = path.join(tempDir, "final_video.mp4");
  
          // Check if the audio file exists
          if (!fs.existsSync(audioPath)) {
            console.error("Audio file does not exist.");
            return res.status(500).json({ error: "Audio file not found." });
          }
  
          // Get durations
          const videoDuration = await getMediaDuration(outputFilePath);
          const audioDuration = await getMediaDuration(audioPath);
  
          // Adjust durations
          const adjustedAudioPath = path.join(tempDir, "adjusted_audio.mp3");
          const extendedVideoPath = path.join(tempDir, "extended_video.mp4");
  
          if (audioDuration < videoDuration) {
            console.log("Audio duration is shorter than video, looping audio.");
            await loopAudio(audioPath, adjustedAudioPath, videoDuration);
          } else {
            console.log("Audio duration is equal to or longer than video, using original audio.");
            fs.copyFileSync(audioPath, adjustedAudioPath); // Use original audio if it's longer
          }
          
          if (videoDuration < audioDuration) {
            console.log("Video duration is shorter than audio, extending video.");
            await extendVideo(outputFilePath, extendedVideoPath, audioDuration);
          } else {
            console.log("Video duration is equal to or longer than audio, using original video.");
            fs.copyFileSync(outputFilePath, extendedVideoPath); // Use original video if it's longer
          }
          
          // Add audio to the video
          ffmpeg(extendedVideoPath)
            .input(adjustedAudioPath)
            .outputOptions([
              "-c:v copy",     // Copy video codec without re-encoding
              "-c:a aac",      // Use AAC codec for audio
              "-map 0:v:0",    // Map the video stream
              "-map 1:a:0",    // Map the audio stream
              "-shortest",     // Stop encoding at the shortest input duration
            ])
            .output(finalVideoPath)
            .on("end", () => {
              console.log("Audio synchronized and added to video successfully.");
              res.download(finalVideoPath, "final_video.mp4", () => {
                // Cleanup temp files after download
                processedFiles.forEach((file) => fs.unlinkSync(file));
                fs.unlinkSync(listFile);
                fs.unlinkSync(outputFilePath);
                fs.unlinkSync(finalVideoPath);
                fs.unlinkSync(audioPath);
                fs.unlinkSync(adjustedAudioPath);
                fs.unlinkSync(extendedVideoPath);
              });
            })
            .on("error", (err) => {
              console.error("Error adding audio to video:", err);
              res.status(500).json({ error: "Error adding audio to video." });
            })
            .run();
  
        })
        .on("error", (err) => {
          console.error("Error during video merging:", err);
          res.status(500).json({ error: "Error during video merging." });
        })
        .run();
    } catch (error) {
      console.error("Error processing videos:", error);
      res.status(500).json({ error: "An error occurred." });
    }
  });
  
  // Utility function to normalize a video
  const normalizeVideo = (inputPath, outputPath) =>
    new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec("libx264")
        .complexFilter([
          "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", // Scale to fit and crop to 1080x1920
        ])
        .fps(30) // Normalize frame rate to 30 FPS
        .on("end", resolve)
        .on("error", reject)
        .run();
    });
  
  
// Default Route
app.get("/", (req, res) => {
  res.send("Reels_Lab Backend is Running!");
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
