const axios = require("axios");
require("dotenv").config();

const fetchPixabayVideos = async (keywords, limit = 30, orientation = "portrait") => {
  const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;
  const query = keywords.split(" ").join("+");
  const url = `https://pixabay.com/api/videos/?key=${PIXABAY_API_KEY}&q=${query}`;

  try {
    const response = await axios.get(url);

    // Filter videos based on the specified orientation and dimensions (1080x1920 for portrait)
    const filteredVideos = response.data.hits.filter((hit) => {
      const videoWidth = hit.videos.large.width;
      const videoHeight = hit.videos.large.height;

      if (orientation === "portrait") {
        return videoWidth === 1080 && videoHeight === 1920;
      } else if (orientation === "landscape") {
        return videoWidth === 1920 && videoHeight === 1080;
      }
      return true; // Default case: no filter
    });

    // Limit the number of results to the specified limit
    return filteredVideos.slice(0, limit);
  } catch (error) {
    console.error("Error fetching videos from Pixabay:", error);
    throw new Error("Failed to fetch videos from Pixabay.");
  }
};

module.exports = { fetchPixabayVideos };
