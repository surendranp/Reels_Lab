const axios = require("axios");
require("dotenv").config();

const fetchPexelsVideos = async (query, limit = 30) => {
  try {
    const apiKey = process.env.PEXELS_API_KEY;

    if (!apiKey) {
      throw new Error("Pexels API key is missing. Check your .env file.");
    }

    console.log("Fetching Pexels videos with query:", query);

    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query.trim())}&per_page=${limit}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: apiKey,
      },
    });

    console.log("Raw API Response:", JSON.stringify(response.data, null, 2));

    if (!response.data || !response.data.videos) {
      console.warn("No valid video data found in response.");
      return [];
    }

    // Extract only videos with valid URLs
    const videos = response.data.videos.map((video) => ({
      url: video.video_files.find((file) => file.quality === "hd")?.link || video.video_files[0]?.link || "",
      title: video.user?.name || "Untitled",
      width: video.width || 1920,
      height: video.height || 1080,
      duration: video.duration || 0,
    })).filter(video => video.url);

    console.log("Final Processed Videos:", videos);

    return videos;
  } catch (error) {
    console.error("Error fetching videos from Pexels:", error.message);
    return [];
  }
};

module.exports = { fetchPexelsVideos };
