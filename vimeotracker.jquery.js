/*
 * VimeoTracker plugin for jQuery by Emile Perron
 * Repo: https://github.com/Cunrakes/VimeoTracker
*/
;( function( $, window, document, undefined ) {
	"use strict";

		// window and document are passed through as local variables rather than global
		// as this (slightly) quickens the resolution process and can be more efficiently
		// minified (especially when both are regularly referenced in your plugin).

		// Create the defaults once
		var pluginName = "vimeoTracker",
			defaults = {
                vimeo_api_url: 'https://player.vimeo.com/api/player.js'
			},
			self = null,
			vimeo = {},
			tracking_data = {};

		// The actual plugin constructor
		function Plugin ( element, options ) {
			this.element = element;
			self = this;

			// jQuery has an extend method which merges the contents of two or
			// more objects, storing the result in the first object. The first object
			// is generally empty as we don't want to alter the default options for
			// future instances of the plugin
			this.settings = $.extend( {}, defaults, options );
			this._defaults = defaults;
			this._name = pluginName;
			this.init();
		}

		// Avoid Plugin.prototype conflicts
		$.extend( Plugin.prototype, {
			init: function() {

                if (typeof Vimeo === 'undefined' && $('html').attr('data-vimeotracker-api-loading') != 1) {
					$('html').attr('data-vimeotracker-api-loading', 1);
					$.getScript(defaults.vimeo_api_url, function(){
						$('html')[0].removeAttribute('data-vimeotracker-api-loading');
					});
                }
				
				// Wait until Vimeo API is loaded and complete initialization
				this.vimeoLoadingInterval = setInterval(function(){
					if (typeof Vimeo != 'undefined') {
						clearInterval(self.vimeoLoadingInterval);
						
						// Set variables that will be used throughout runtime
						if ($(self.element).find('iframe').length == 0) {
							console.error("No iframe element was found within the given element.");
							return;
						}
						
						vimeo.player = new Vimeo.Player($(self.element).find('iframe')[0]);
						vimeo.id = undefined;
						vimeo.title = undefined;
						vimeo.duration = 0;
						vimeo.current_time = 0;
						
						self.initParameters();
						self.initListeners();
						
						$(self.element).trigger('init_end');
					}
				}, 100);
			},
			initParameters: function() {
				self.time_tracker = null; // An time-tracking interval is stored here during runtime
				self.view_session_hash = ''; // Unique hash that changes upon page refresh - usually provided by the server after the first request
				self.previous_ajax_call_completed = true; // Tracks the completion status of the previous ajax request to avoid multiple simultaneous requests
				
				self.settings.completed_at = typeof self.settings.completed_at == 'undefined' ? 1 : self.settings.completed_at;
				self.settings.allow_seek = typeof self.settings.allow_seek == 'undefined' ? true : self.settings.allow_seek;
				self.settings.initial_seek_limit = typeof self.settings.initial_seek_limit == 'undefined' ? 0 : self.settings.initial_seek_limit;
				self.settings.seek_detection_threshold = typeof self.settings.seek_detection_threshold == 'undefined' ? 2 : self.settings.seek_detection_threshold;
				self.settings.update_url = typeof self.settings.update_url == 'undefined' ? null : self.settings.update_url;
				self.settings.update_method = typeof self.settings.update_method == 'undefined' ? 'get' : self.settings.update_method;
				self.settings.update_datatype = typeof self.settings.update_datatype == 'undefined' ? 'json' : self.settings.update_datatype;
				self.settings.update_success_callback = typeof self.settings.update_success_callback == 'undefined' ? null : self.settings.update_success_callback;
				self.settings.update_error_callback = typeof self.settings.update_error_callback == 'undefined' ? null : self.settings.update_error_callback;
				
				tracking_data.furthest_reached = 0;
				tracking_data.total_watch_time = 0;
				tracking_data.video_completed = false;
				
				// Get video duration
				vimeo.player.getDuration().then(function(duration) {
					vimeo.duration = duration;
					$(self.element).trigger('videoDurationFetched', [duration]);
				});
				// Get video title
				vimeo.player.getVideoTitle().then(function(title) {
					vimeo.title = title;
					$(self.element).trigger('videoTitleFetched', [title]);
				});
				// Get video ID
				vimeo.player.getVideoId().then(function(id) {
					vimeo.id = id;
					$(self.element).trigger('videoIdFetched', [id]);
				});
			},
			initListeners: function() {
				vimeo.player.on('play', function(){
					self.time_tracker = setInterval(function(){
						tracking_data.total_watch_time += 1;
						// Send data to DB in ajax every time it's possible
						$(self.element).trigger('beforeSendUpdate');
						self.sendUpdate();
						$(self.element).trigger('afterSendUpdate');
					}, 1000);
					
					$(self.element).trigger('videoPlayed');
				});
				
				vimeo.player.on('pause', function(){
					clearInterval(self.time_tracker);
					$(self.element).trigger('videoPaused');
				});
				
				// This is where the magic happens - on every time update event
				vimeo.player.on('timeupdate', function(data) {
					// Update time and check if unallowed seeking occured
					if (!self.settings.allow_seek && data.seconds - tracking_data.furthest_reached > self.settings.seek_detection_threshold && data.seconds > self.settings.initial_seek_limit) {
						// Unallowed seeking detected - bring user back
						vimeo.player.setCurrentTime(tracking_data.furthest_reached > vimeo.current_time ? tracking_data.furthest_reached : vimeo.current_time);
						$(self.element).trigger('unallowedSeekDetected');
					} else {
						vimeo.current_time = data.seconds;
					}
					
					// Update duration with more precise duration if possible
					if (data.duration != vimeo.duration)
						vimeo.duration = data.duration;
					
					if (vimeo.current_time > tracking_data.furthest_reached)
						tracking_data.furthest_reached = vimeo.current_time;
						
					if (!tracking_data.video_completed && vimeo.current_time >= vimeo.duration * self.settings.completed_at) {
                        tracking_data.video_completed = true;
						$(self.element).trigger('videoCompleted');
                    }
				});
			},
			setOption: function(key, value) {
				self.settings[key] = value;
			},
			sendUpdate: function() {
				if (self.settings.update_url && self.previous_ajax_call_completed) {
					// Disable further ajax calls until a reponse is received
					self.previous_ajax_call_completed = false;
					
                    $.ajax({
						url: self.settings.update_url,
						type: self.settings.update_method,
						dataType: self.settings.update_datatype,
						data: {
							video_id: vimeo.id,
							video_title: vimeo.title,
							video_duration: vimeo.duration,
							furthest_reached: tracking_data.furthest_reached,
							total_watch_time: tracking_data.total_watch_time,
							view_session_hash: self.view_session_hash
						},
						success: function(data){
							self.settings.update_success_callback(self, data);

							// Re-enable ajax calls
							self.previous_ajax_call_completed = true;
						},
						error: function(data){
							self.settings.update_error_callback(self, data);
						}
					});
                } else if (self.settings.update_url && !self.previous_ajax_call_completed) {
					console.warn("Video tracking update not sent - waiting on previous request's response.");
                }
			}
		} );

		// A really lightweight plugin wrapper around the constructor,
		// preventing against multiple instantiations
		$.fn[ pluginName ] = function( options ) {
			return this.each( function() {
				if ( !$.data( this, "plugin_" + pluginName ) ) {
					$.data( this, "plugin_" +
						pluginName, new Plugin( this, options ) );
				}
			} );
		};

} )( jQuery, window, document );