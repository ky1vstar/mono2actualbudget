const axios = require('axios');

// Constants
const API_BASE_URL = 'https://api.monobank.ua';

class MonoApi {
  constructor() {
    this.token = null;
  }
  
  async init(token) {
    if (!token) {
      throw new Error('Monobank API token is required');
    }
    this.token = token;
    return this;
  }

  getHeaders() {
    if (!this.token) {
      throw new Error('API not initialized. Call init(token) first.');
    }
    
    return {
      'X-Token': this.token
    };
  }

  async getClientInfo() {
    try {
      const response = await axios.get(`${API_BASE_URL}/personal/client-info`, {
        headers: this.getHeaders(),
      });
      
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.warn('Rate limit exceeded. Waiting 60 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds
        return this.getClientInfo();
      }

      console.error('Error fetching client info:', error.message);
      throw error;
    }
  }

  async getStatements(accountId, fromTimestamp, toTimestamp) {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/personal/statement/${accountId}/${fromTimestamp}/${toTimestamp}`, 
        { headers: this.getHeaders() }
      );
      
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.warn('Rate limit exceeded. Waiting 60 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds
        return this.getStatements(accountId, fromTimestamp, toTimestamp);
      }
      
      console.error('Error fetching statements:', error.message);
      throw error;
    }
  }

  // Helper function to handle Monobank's rate limit (1 request per minute)
  async sleep() {
    console.log('Waiting 60 seconds to respect Monobank API rate limit...');
    return new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
  }
}

module.exports = () => new MonoApi();
