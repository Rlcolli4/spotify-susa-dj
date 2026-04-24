const ARIZONA_TIME_ZONE = 'America/Phoenix';

function getArizonaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ARIZONA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  return parts.reduce((result, part) => {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
    return result;
  }, {});
}

function getArizonaDateString(date = new Date()) {
  const parts = getArizonaParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getArizonaHour(date = new Date()) {
  return Number(getArizonaParts(date).hour);
}

function isArizonaQuietHours(date = new Date()) {
  return getArizonaHour(date) < 7;
}

function isArizonaEveningCutoffWindow(date = new Date()) {
  return getArizonaHour(date) >= 19;
}

function wasUpdatedBeforeTodayEveningCutoff(updatedAt, now = new Date()) {
  if (!updatedAt || !isArizonaEveningCutoffWindow(now)) {
    return false;
  }

  const currentDate = getArizonaDateString(now);
  const updatedDate = getArizonaDateString(new Date(updatedAt));

  if (updatedDate < currentDate) {
    return true;
  }

  if (updatedDate > currentDate) {
    return false;
  }

  return getArizonaHour(new Date(updatedAt)) < 19;
}

module.exports = {
  ARIZONA_TIME_ZONE,
  getArizonaDateString,
  getArizonaHour,
  isArizonaQuietHours,
  isArizonaEveningCutoffWindow,
  wasUpdatedBeforeTodayEveningCutoff
};
