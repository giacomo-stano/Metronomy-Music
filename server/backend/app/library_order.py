"""Library ordering is global, before pagination, never release-year ordering."""
from datetime import datetime, timezone
import unicodedata


def added_at(item):
    value = item.get('created') or item.get('createdAt')
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).timestamp()
    except (ValueError, TypeError, OverflowError):
        return None


def ordered_songs(items, order):
    def label(value):
        return ''.join(c for c in unicodedata.normalize('NFKD', str(value or '')).casefold()
                       if not unicodedata.combining(c))

    def key(item):
        tie = (label(item.get('title')), str(item.get('id', '')))
        if order == 'title':
            return tie
        if order == 'artist':
            return (label(item.get('artist')), *tie)
        added = added_at(item)
        # Missing dates stay last in both directions; never substitute release year.
        return (added is None, -(added or 0) if order == 'newest' else (added or 0), *tie)

    return sorted(items, key=key)
