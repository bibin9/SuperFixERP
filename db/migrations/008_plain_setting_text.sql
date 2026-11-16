-- Screens show plain words: drop requirement codes such as "(FP-05)" from setting descriptions.
UPDATE setting SET description = regexp_replace(description, ' \([A-Z]{2}-[0-9]{2}\)', '', 'g') WHERE description ~ '\([A-Z]{2}-[0-9]{2}\)';
